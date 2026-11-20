import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { ChevronLeft, ChevronRight, Expand, Hand, Maximize2, Minimize2, MonitorUp, Pin, PinOff, Shrink, SwitchCamera, User } from 'lucide-react';
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  LayoutContext,
  isTrackReference,
  ParticipantTile,
  TrackLoop,
  TrackRefContext,
  type GridLayoutDefinition,
  type LayoutContextType,
  useGridLayout,
  useLocalParticipant,
  usePagination,
  usePinnedTracks,
  useTrackRefContext,
  useTracks,
  VideoTrack,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Button, IconButton, Modal, Notice } from '../../components/ui';
import { RoomBoard } from './boards/RoomBoard';
import { isAssistant } from './assistant/assistantParticipant';
import { WhiteboardElement } from '../../types';
import type { BoardFocus } from '../../components/Whiteboard';
import { usePinchZoom } from './pinchZoom';
import { layoutTiles } from './tileLayout';
import { useCameraSwitch, type CameraSwitch } from './useCameraSwitch';

export interface LiveKitVideoAreaProps {
  layout: 'grid' | 'speaker';
  layoutContext: LayoutContextType;
  isWhiteboardOpen: boolean;
  whiteboardElements?: WhiteboardElement[];
  whiteboardFocus?: BoardFocus;
  whiteboardFailed?: boolean;
  // The generation names the board the elements were drawn on; see RoomBoard.
  onWhiteboardCommit: (elements: WhiteboardElement[], previous: WhiteboardElement[], generation?: number) => void | Promise<void>;
  onWhiteboardClose: () => void;
  isMobile: boolean;
  handRaisedByIdentity: Record<string, boolean>;
  darkMode?: boolean;
  /** A sheet shares the phone's stage: the tiles shrink to one row. */
  compact?: boolean;
}

type TrackRef = TrackReferenceOrPlaceholder;

// LiveKit's own table, except that two across hold up on a phone (2x2, 2x3), and six tiles sit
// three across only when the stage is wide enough, so a side panel folds them to two across.
const MEET_GRID_LAYOUTS: GridLayoutDefinition[] = [
  { columns: 1, rows: 1 },
  { columns: 1, rows: 2, orientation: 'portrait' },
  { columns: 2, rows: 1, orientation: 'landscape' },
  { columns: 2, rows: 2 },
  { columns: 2, rows: 3 },
  { columns: 3, rows: 2, minWidth: 1100 },
  { columns: 3, rows: 3, minWidth: 700 },
  { columns: 4, rows: 4, minWidth: 960 },
  { columns: 5, rows: 5, minWidth: 1100 },
];

const STRIP_SLOTS_WHITEBOARD = 5;
const STRIP_SLOTS_COMPACT = 3;

const initialsOf = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

// Remount key: LiveKit's usePagination keeps stale refs when a placeholder becomes a
// published track (and back), which logs an `updatePages` error. Covered by test
// "remounts pagination when a placeholder becomes a published track".
const getTrackLayoutKey = (trackRefs: TrackRef[]) => trackRefs
  .map((trackRef) => `${trackRef.participant.identity}:${trackRef.source}:${isTrackReference(trackRef) ? trackRef.publication.trackSid : 'placeholder'}`)
  .sort()
  .join('|');

const LANDSCAPE = 16 / 9;
// A phone held sideways has width to spare and little height, so the strip moves beside the large tile.
const SIDEWAYS_QUERY = '(max-width: 60rem) and (orientation: landscape) and (max-height: 30rem)';

const useSideways = () => useSyncExternalStore(
  (onChange) => {
    const query = window.matchMedia(SIDEWAYS_QUERY);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  },
  () => window.matchMedia(SIDEWAYS_QUERY).matches,
);

const tileKeyOf = (trackRef: TrackRef) => `${trackRef.participant.identity}:${trackRef.source}`;
const nameOf = (trackRef: TrackRef) => trackRef.participant.name || trackRef.participant.identity;

// The published size is known before the video plays, so the first layout is already close.
const aspectOf = (trackRef: TrackRef, measured: Record<string, number>) => {
  if (!isTrackReference(trackRef) || trackRef.publication.isMuted) return LANDSCAPE;
  const dimensions = trackRef.publication.dimensions;
  return measured[tileKeyOf(trackRef)]
    ?? (dimensions?.width && dimensions.height ? dimensions.width / dimensions.height : LANDSCAPE);
};

// Media events do not bubble, so they are caught on the way down. Turning a phone only fires `resize`.
const useVideoAspects = (rootRef: React.RefObject<HTMLElement | null>) => {
  const [aspects, setAspects] = useState<Record<string, number>>({});
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const read = (event: Event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement) || !video.videoWidth || !video.videoHeight) return;
      const key = video.closest('[data-tile-key]')?.getAttribute('data-tile-key');
      if (!key) return;
      const aspect = video.videoWidth / video.videoHeight;
      setAspects((current) => (current[key] === aspect ? current : { ...current, [key]: aspect }));
    };
    root.addEventListener('loadedmetadata', read, true);
    root.addEventListener('resize', read, true);
    return () => {
      root.removeEventListener('loadedmetadata', read, true);
      root.removeEventListener('resize', read, true);
    };
  }, [rootRef]);
  return aspects;
};

interface TileActions {
  focusKey?: string;
  userPinKey: string | null;
  fillKey: string | null;
  localIdentity?: string;
  camera: CameraSwitch;
  showLarge: (trackRef: TrackRef) => void;
  togglePin: (trackRef: TrackRef) => void;
  toggleFill: (trackRef: TrackRef) => void;
  openSheet: (trackRef: TrackRef) => void;
}

// Only the grid and the large view provide this: a strip or your own small picture has no room for tools.
const TileActionsContext = createContext<TileActions | null>(null);

const TileTools: React.FC<{ trackRef: TrackRef; actions: TileActions }> = ({ trackRef, actions }) => {
  const key = tileKeyOf(trackRef);
  const name = nameOf(trackRef);
  const isCamera = trackRef.source === Track.Source.Camera;
  const isFocused = actions.focusKey === key;
  const isPinned = actions.userPinKey === key;
  const isFilled = actions.fillKey === key;
  const canSwitch = isCamera && trackRef.participant.identity === actions.localIdentity && actions.camera.canSwitch;
  return (
    <>
      <div className="mtile__tools">
        {canSwitch && (
          <IconButton onBoard label={t`Switch camera`} onClick={() => void actions.camera.switchCamera()} disabled={actions.camera.switching}>
            <SwitchCamera className="icon" aria-hidden="true" />
          </IconButton>
        )}
        {isFocused && isCamera && (
          <IconButton onBoard label={isFilled ? t`Show the whole picture` : t`Fill the frame`} onClick={() => actions.toggleFill(trackRef)}>
            {isFilled ? <Shrink className="icon" aria-hidden="true" /> : <Expand className="icon" aria-hidden="true" />}
          </IconButton>
        )}
        <IconButton onBoard label={isPinned ? t`Unpin ${name}` : t`Pin ${name} for me`} onClick={() => actions.togglePin(trackRef)}>
          {isPinned ? <PinOff className="icon" aria-hidden="true" /> : <Pin className="icon" aria-hidden="true" />}
        </IconButton>
        {!isFocused && (
          <IconButton onBoard label={t`Show ${name} large`} onClick={() => actions.showLarge(trackRef)}>
            <Maximize2 className="icon" aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <button type="button" className="mtile__tap" aria-label={t`Options for ${name}`} onClick={() => actions.openSheet(trackRef)} />
    </>
  );
};

const TileSheet: React.FC<{ trackRef: TrackRef; actions: TileActions; onClose: () => void }> = ({ trackRef, actions, onClose }) => {
  const key = tileKeyOf(trackRef);
  const name = nameOf(trackRef);
  const isCamera = trackRef.source === Track.Source.Camera;
  const canSwitch = isCamera && trackRef.participant.identity === actions.localIdentity && actions.camera.canSwitch;
  const run = (action: () => void) => () => { action(); onClose(); };
  return (
    <Modal isOpen onClose={onClose} ariaLabel={name} className="msheet">
      <p className="msheet__name">{name}</p>
      {actions.focusKey !== key && (
        <button type="button" className="menu__item" onClick={run(() => actions.showLarge(trackRef))}>
          <Maximize2 className="icon" aria-hidden="true" /><span><Trans>Show large</Trans></span>
        </button>
      )}
      <button type="button" className="menu__item" onClick={run(() => actions.togglePin(trackRef))}>
        {actions.userPinKey === key
          ? <><PinOff className="icon" aria-hidden="true" /><span><Trans>Unpin</Trans></span></>
          : <><Pin className="icon" aria-hidden="true" /><span><Trans>Pin for me</Trans></span></>}
      </button>
      {actions.focusKey === key && isCamera && (
        <button type="button" className="menu__item" onClick={run(() => actions.toggleFill(trackRef))}>
          {actions.fillKey === key
            ? <><Shrink className="icon" aria-hidden="true" /><span>{t`Show the whole picture`}</span></>
            : <><Expand className="icon" aria-hidden="true" /><span>{t`Fill the frame`}</span></>}
        </button>
      )}
      {canSwitch && (
        <button type="button" className="menu__item" onClick={run(() => void actions.camera.switchCamera())}>
          <SwitchCamera className="icon" aria-hidden="true" /><span>{t`Switch camera`}</span>
        </button>
      )}
      <Button variant="secondary" className="msheet__close" onClick={onClose}><Trans>Close</Trans></Button>
    </Modal>
  );
};

const ParticipantTileWithHandRaise: React.FC<{ handRaisedByIdentity: Record<string, boolean> }> = ({ handRaisedByIdentity }) => {
  const trackRef = useTrackRefContext();
  const actions = useContext(TileActionsContext);
  const identity = trackRef?.participant?.identity;
  const isCamera = trackRef?.source === Track.Source.Camera;
  const isRaised = !!identity && !!handRaisedByIdentity[identity];
  const key = trackRef ? tileKeyOf(trackRef) : undefined;
  // Only a large shared screen: small print is why anyone zooms, and a focused tile has the room for it.
  const zoomable = !!key && actions?.focusKey === key && trackRef?.source === Track.Source.ScreenShare;
  const zoom = usePinchZoom(zoomable);

  return (
    <div
      className="mtile relative w-full h-full"
      data-tile-key={key}
      data-fill={!!key && actions?.fillKey === key}
      data-zoomable={zoomable}
      data-zoomed={zoom.zoomed}
      style={zoom.zoomed ? { '--mzoom': zoom.transform } as React.CSSProperties : undefined}
      {...zoom.handlers}
    >
      <ParticipantTile className="w-full h-full" />
      {/* Shown by CSS while the tile reports its camera as muted. A camera that was never published reports nothing. */}
      {isCamera && (
        <span className={`mtile__cam ${trackRef?.publication ? '' : 'is-off'}`} aria-hidden="true">
          <span className="tile__initial">{initialsOf(trackRef?.participant?.name || identity || '')}</span>
        </span>
      )}
      {isCamera && isRaised && (
        <span className="tile__flag mtile__flag">
          <Hand className="icon" aria-hidden="true" />
          <span><Trans>Hand Raised</Trans></span>
        </span>
      )}
      {actions && trackRef && <TileTools trackRef={trackRef} actions={actions} />}
      {zoom.zoomed && (
        <Button type="button" variant="secondary" size="sm" className="mtile__zoomreset" onClick={zoom.reset}><Trans>Reset zoom</Trans></Button>
      )}
    </div>
  );
};

const PaginationControls: React.FC<{
  totalPageCount: number;
  currentPage: number;
  nextPage: () => void;
  prevPage: () => void;
}> = ({ totalPageCount, currentPage, nextPage, prevPage }) => {
  if (totalPageCount <= 1) return null;
  return (
    <div className="lk-pagination-controls">
      <div className="pager lk-pagination-control" data-lk-user-interaction="true">
        <IconButton onBoard label={t`Previous page`} onClick={prevPage} disabled={currentPage <= 1}><ChevronLeft className="icon" aria-hidden="true" /></IconButton>
        <span className="lk-pagination-count fig" role="status" aria-label={t`Current page`}>{currentPage}/{totalPageCount}</span>
        <IconButton onBoard label={t`Next page`} onClick={nextPage} disabled={currentPage >= totalPageCount}><ChevronRight className="icon" aria-hidden="true" /></IconButton>
      </div>
    </div>
  );
};

export const MeetGrid: React.FC<{
  tracks: TrackRef[];
  handRaisedByIdentity: Record<string, boolean>;
  pageRef: React.MutableRefObject<number>;
}> = ({ tracks, handRaisedByIdentity, pageRef }) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // LiveKit still types the ref without React 19's null.
  const { layout } = useGridLayout(gridRef as React.RefObject<HTMLDivElement>, tracks.length, { gridLayouts: MEET_GRID_LAYOUTS });
  const columns = Math.max(layout.columns || 1, 1);
  const pagination = usePagination(Math.max(layout.maxTiles || columns, columns), tracks);
  const measured = useVideoAspects(gridRef);
  const [stage, setStage] = useState({ width: 0, height: 0, gap: 0 });
  // The grid remounts when a panel folds it away or the tracks change; people stay on the page they were reading.
  useEffect(() => { pagination.setPage(pageRef.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { pageRef.current = pagination.currentPage; }, [pagination.currentPage, pageRef]);
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(() => {
      setStage({
        width: element.clientWidth,
        height: element.clientHeight,
        gap: parseFloat(getComputedStyle(element).rowGap) || 0,
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageTracks = pagination.tracks;
  const sizedRows = layoutTiles(pageTracks.map((trackRef) => aspectOf(trackRef, measured)), stage.width, stage.height, stage.gap);
  // Before the first measurement the tiles share the stage evenly.
  const rows = sizedRows.length > 0
    ? sizedRows.map((row) => ({ height: row.height as number | undefined, tiles: row.tiles.map((tile) => ({ trackRef: pageTracks[tile.index], width: tile.width as number | undefined })) }))
    : Array.from({ length: Math.ceil(pageTracks.length / columns) }, (_, rowIndex) => ({
      height: undefined as number | undefined,
      tiles: pageTracks.slice(rowIndex * columns, (rowIndex + 1) * columns).map((trackRef) => ({ trackRef, width: undefined as number | undefined })),
    }));

  return (
    <div
      ref={gridRef}
      className="lk-grid-layout relative flex h-full w-full flex-col"
      data-testid="grid-layout"
      data-lk-pagination={pagination.totalPageCount > 1}
    >
      <div ref={stageRef} className="mgrid__stage">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className={`lk-grid-row flex w-full justify-center ${row.height === undefined ? 'min-h-0 flex-1' : 'flex-none'}`} style={row.height === undefined ? undefined : { height: row.height }}>
            {row.tiles.map(({ trackRef, width }) => (
              <div key={`${trackRef.participant.identity}-${trackRef.source}-${isTrackReference(trackRef) ? trackRef.publication.trackSid : 'placeholder'}`} className="lk-grid-tile-wrapper h-full min-w-0" style={{ width: width ?? `calc((100% - ${columns - 1} * var(--mgrid-gap)) / ${columns})` }}>
                <TrackLoop tracks={[trackRef]}>
                  <ParticipantTileWithHandRaise handRaisedByIdentity={handRaisedByIdentity} />
                </TrackLoop>
              </div>
            ))}
          </div>
        ))}
      </div>
      <PaginationControls {...pagination} />
    </div>
  );
};

// Your own screen stays small: shown large, a shared meeting tab or whole screen would film itself without end.
const LocalPresentingPlaceholder: React.FC<{ trackRef: TrackRef; onStop: () => void }> = ({ trackRef, onStop }) => (
  <div data-testid="presenting-placeholder" className="flex h-full w-full flex-col items-center justify-center gap-3">
    {/* LiveKit's unlayered video styles beat ours, so the frame sets the size and the video only its fit. */}
    {isTrackReference(trackRef) && <div className="mpresent__preview"><VideoTrack trackRef={trackRef} style={{ objectFit: 'contain' }} /></div>}
    <div className="toast mpresent">
      <MonitorUp className="icon" aria-hidden="true" />
      <span><Trans>You are presenting to everyone</Trans></span>
      <Button type="button" variant="secondary" size="sm" onClick={onStop}><Trans>Stop presenting</Trans></Button>
    </div>
    <p className="mpresent__hint"><Trans>Only you see this preview. Everyone else sees your screen full size.</Trans></p>
  </div>
);

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const SELF_WIDTH_PORTRAIT = 96;
const SELF_WIDTH_LANDSCAPE = 160;

const SelfWindow: React.FC<{
  trackRef: TrackRef;
  onMinimize: () => void;
  corner: Corner;
  onCornerChange: (corner: Corner) => void;
  handRaisedByIdentity: Record<string, boolean>;
  layoutContext: LayoutContextType;
  camera: CameraSwitch;
}> = ({ trackRef, onMinimize, corner, onCornerChange, handRaisedByIdentity, layoutContext, camera }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const measured = useVideoAspects(rootRef);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const aspect = aspectOf(trackRef, measured);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current) setOffset({ x: event.clientX - dragStart.current.x, y: event.clientY - dragStart.current.y });
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    setOffset(null);
    const stage = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!stage) return;
    const top = event.clientY < stage.top + stage.height / 2;
    const left = event.clientX < stage.left + stage.width / 2;
    onCornerChange(`${top ? 't' : 'b'}${left ? 'l' : 'r'}`);
  };

  return (
    <div
      ref={rootRef}
      data-testid="local-pip"
      data-corner={corner}
      className="selfpill mself mself--open"
      style={{
        width: aspect < 1 ? SELF_WIDTH_PORTRAIT : SELF_WIDTH_LANDSCAPE,
        aspectRatio: aspect,
        transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <LayoutContext.Provider value={layoutContext}>
        <TrackRefContext.Provider value={trackRef}>
          <ParticipantTileWithHandRaise handRaisedByIdentity={handRaisedByIdentity} />
        </TrackRefContext.Provider>
      </LayoutContext.Provider>
      <IconButton onBoard label={t`Minimize your camera`} onClick={onMinimize} className="mself__close">
        <Minimize2 className="icon" aria-hidden="true" />
      </IconButton>
      {camera.canSwitch && (
        <IconButton onBoard label={t`Switch camera`} onClick={() => void camera.switchCamera()} disabled={camera.switching} className="mself__flip">
          <SwitchCamera className="icon" aria-hidden="true" />
        </IconButton>
      )}
    </div>
  );
};

const LocalPictureInPicture: React.FC<{
  trackRef: TrackRef;
  localName: string;
  handRaisedByIdentity: Record<string, boolean>;
  layoutContext: LayoutContextType;
  camera: CameraSwitch;
}> = ({ trackRef, localName, handRaisedByIdentity, layoutContext, camera }) => {
  const [minimized, setMinimized] = useState(false);
  const [corner, setCorner] = useState<Corner>('br');
  if (minimized) {
    return (
      <button data-testid="local-pip" type="button" onClick={() => setMinimized(false)} aria-label={t`Expand your camera`} className="selfpill mself">
        <span className="tile__name">
          <User className="icon" aria-hidden="true" />
          <span className="mself__name">{localName || <Trans>You</Trans>}</span>
          <Maximize2 className="icon" aria-hidden="true" />
        </span>
      </button>
    );
  }
  return (
    <SelfWindow
      trackRef={trackRef}
      onMinimize={() => setMinimized(true)}
      corner={corner}
      onCornerChange={setCorner}
      handRaisedByIdentity={handRaisedByIdentity}
      layoutContext={layoutContext}
      camera={camera}
    />
  );
};

// A column or row of tiles beside the real work: the last slot counts whoever does not fit.
const TileStrip: React.FC<{
  tracks: TrackRef[];
  slots: number;
  className: string;
  handRaisedByIdentity: Record<string, boolean>;
}> = ({ tracks, slots, className, handRaisedByIdentity }) => {
  const overflows = tracks.length > slots;
  const shown = overflows ? tracks.slice(0, slots - 1) : tracks;
  const more = tracks.length - shown.length;
  return (
    <div className={className}>
      <TrackLoop tracks={shown}>
        <ParticipantTileWithHandRaise handRaisedByIdentity={handRaisedByIdentity} />
      </TrackLoop>
      {overflows && (
        <div className="tile tile--more" role="img" aria-label={t`${more} more`}>
          <span className="tile__initial fig">+{more}</span>
        </div>
      )}
    </div>
  );
};

const VideoStage: React.FC<LiveKitVideoAreaProps & { camera: CameraSwitch }> = ({
  camera,
  layout,
  layoutContext,
  isWhiteboardOpen,
  whiteboardElements,
  whiteboardFocus,
  whiteboardFailed = false,
  onWhiteboardCommit,
  onWhiteboardClose,
  isMobile,
  handRaisedByIdentity,
  compact = false,
}) => {
  const { localParticipant } = useLocalParticipant();
  const sideways = useSideways();
  const gridPageRef = useRef(1);
  const allTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  ) as TrackRef[];
  const tracks = useMemo(() => allTracks.filter((track) => !isAssistant(track.participant)), [allTracks]);
  const localIdentity = localParticipant?.identity;
  const participantCount = new Set(tracks.map((track) => track.participant.identity)).size;
  // On a phone your own picture is a small window; on a wide stage you are a tile like everyone else.
  const selfInWindow = isMobile && participantCount >= 2;
  const contentTracks = selfInWindow
    ? tracks.filter((track) => !(track.participant.identity === localIdentity && track.source === Track.Source.Camera))
    : tracks;
  const screenShareTracks = tracks.filter((track): track is TrackReference => track.source === Track.Source.ScreenShare && isTrackReference(track));
  const localCameraTrack = tracks.find((track) => track.participant.identity === localIdentity && track.source === Track.Source.Camera);
  const [userPinKey, setUserPinKey] = useState<string | null>(null);
  const [fillKey, setFillKey] = useState<string | null>(null);
  const [sheetTrack, setSheetTrack] = useState<TrackRef | null>(null);
  const lastAutoFocusedScreenShareTrack = useRef<TrackRef | null>(null);
  const lastSpeakerIdentity = useRef<string | null>(null);
  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const speakingRemote = contentTracks.find(
    (track) => track.source === Track.Source.Camera && track.participant.identity !== localIdentity && track.participant.isSpeaking,
  );
  const stickySpeakerTrack = useMemo(
    () => contentTracks.find((track) => track.source === Track.Source.Camera && track.participant.identity === lastSpeakerIdentity.current),
    [contentTracks],
  );
  const speakerTrack = speakingRemote ?? stickySpeakerTrack;

  useEffect(() => {
    if (speakingRemote) lastSpeakerIdentity.current = speakingRemote.participant.identity;
  }, [speakingRemote]);

  const pinnedByUser = !!focusTrack && tileKeyOf(focusTrack) === userPinKey;

  useEffect(() => {
    if (screenShareTracks.some((track) => track.publication.isSubscribed) && lastAutoFocusedScreenShareTrack.current === null) {
      // A share does not take the stage from someone you pinned, and does not come back after you leave that view.
      if (!pinnedByUser) layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: screenShareTracks[0] });
      lastAutoFocusedScreenShareTrack.current = screenShareTracks[0];
    } else if (lastAutoFocusedScreenShareTrack.current && !screenShareTracks.some((track) => track.publication.trackSid === lastAutoFocusedScreenShareTrack.current?.publication?.trackSid)) {
      if (focusTrack?.publication?.trackSid === lastAutoFocusedScreenShareTrack.current.publication?.trackSid) {
        layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
      }
      lastAutoFocusedScreenShareTrack.current = null;
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updatedFocusTrack = tracks.find((track) => track.participant.identity === focusTrack.participant.identity && track.source === focusTrack.source);
      if (updatedFocusTrack !== focusTrack && isTrackReference(updatedFocusTrack)) {
        layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: updatedFocusTrack });
      }
    }
  }, [screenShareTracks.map((ref) => `${ref.publication.trackSid}_${ref.publication.isSubscribed}`).join(), focusTrack?.publication?.trackSid, tracks]);

  const availablePinnedFocus = focusTrack && tracks.some((track) => track.participant.identity === focusTrack.participant.identity && track.source === focusTrack.source) ? focusTrack : undefined;
  const effectiveFocus = availablePinnedFocus ?? (layout === 'speaker'
    ? (speakerTrack ?? contentTracks.find((track) => track.source === Track.Source.Camera && track.participant.identity !== localIdentity) ?? contentTracks[0])
    : undefined);
  const carouselTracks = effectiveFocus
    ? contentTracks.filter((trackRef) => trackRef.participant.identity !== effectiveFocus.participant.identity || trackRef.source !== effectiveFocus.source)
    : [];
  const localPresenting = !!effectiveFocus && effectiveFocus.participant.identity === localIdentity && effectiveFocus.source === Track.Source.ScreenShare;
  const showPip = selfInWindow && !!localCameraTrack && !(effectiveFocus?.participant.identity === localIdentity && effectiveFocus.source === Track.Source.Camera);

  const localPip = showPip && localCameraTrack
    ? <LocalPictureInPicture trackRef={localCameraTrack} localName={localParticipant?.name || localIdentity || ''} handRaisedByIdentity={handRaisedByIdentity} layoutContext={layoutContext} camera={camera} />
    : null;
  const showLarge = (trackRef: TrackRef) => layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: trackRef as TrackReference });
  const leaveLargeView = () => {
    setUserPinKey(null);
    setFillKey(null);
    layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
  };
  const tileActions: TileActions = {
    focusKey: effectiveFocus ? tileKeyOf(effectiveFocus) : undefined,
    userPinKey,
    fillKey,
    localIdentity,
    camera,
    showLarge,
    togglePin: (trackRef) => {
      const key = tileKeyOf(trackRef);
      if (userPinKey === key) {
        setUserPinKey(null);
        return;
      }
      setUserPinKey(key);
      showLarge(trackRef);
    },
    toggleFill: (trackRef) => {
      const key = tileKeyOf(trackRef);
      setFillKey((current) => (current === key ? null : key));
    },
    openSheet: setSheetTrack,
  };
  const sheet = sheetTrack && <TileSheet trackRef={sheetTrack} actions={tileActions} onClose={() => setSheetTrack(null)} />;

  // Beside the whiteboard or under a sheet the local tile joins the strip: there is no room for the pill.
  const stripTracks = [
    ...(effectiveFocus ? [effectiveFocus, ...carouselTracks] : contentTracks),
    ...(showPip && localCameraTrack ? [localCameraTrack] : []),
  ];

  if (isWhiteboardOpen) {
    return (
      <div className={`wbwrap mwb h-full w-full ${isMobile ? 'mwb--alone' : ''}`}>
        <div className="mwb__sheet">
          {whiteboardFailed ? (
            <div className="mquiet">
              <Notice variant="error"><Trans>The whiteboard could not be loaded. Leave the meeting and join again to retry.</Trans></Notice>
              <Button variant="secondary" onClick={onWhiteboardClose}><Trans>Close</Trans></Button>
            </div>
          ) : <RoomBoard onClose={onWhiteboardClose} elements={whiteboardElements} focus={whiteboardFocus} onCommit={onWhiteboardCommit} />}
        </div>
        {!isMobile && <TileStrip tracks={stripTracks} slots={STRIP_SLOTS_WHITEBOARD} className="strip mstrip--column" handRaisedByIdentity={handRaisedByIdentity} />}
      </div>
    );
  }
  if (tracks.length === 0) {
    return (
      <div className="tile h-full w-full">
        <span className="tile__flag"><Trans>Waiting for participants...</Trans></span>
      </div>
    );
  }
  if (compact) {
    return <TileStrip tracks={stripTracks} slots={STRIP_SLOTS_COMPACT} className="mstrip--row" handRaisedByIdentity={handRaisedByIdentity} />;
  }
  if (!effectiveFocus) {
    return (
      <div className="relative h-full w-full">
        <TileActionsContext.Provider value={tileActions}>
          <MeetGrid key={getTrackLayoutKey(contentTracks)} tracks={contentTracks} handRaisedByIdentity={handRaisedByIdentity} pageRef={gridPageRef} />
        </TileActionsContext.Provider>
        {participantCount <= 1 && <span className="tile__flag mtile__flag"><Trans>Waiting for participants...</Trans></span>}
        {localPip}
        {sheet}
      </div>
    );
  }

  const carouselOrientation = isMobile && !sideways ? 'horizontal' : 'vertical';
  return (
    <div className="relative h-full w-full">
      <TileActionsContext.Provider value={tileActions}>
      <FocusLayoutContainer className="h-full min-h-0">
        <React.Fragment key={getTrackLayoutKey(carouselTracks)}>
          <CarouselLayout tracks={carouselTracks} orientation={carouselOrientation} className="lk-carousel">
            <ParticipantTileWithHandRaise handRaisedByIdentity={handRaisedByIdentity} />
          </CarouselLayout>
        </React.Fragment>
        {localPresenting ? (
          <div className="flex-1 min-w-0 min-h-0"><LocalPresentingPlaceholder trackRef={effectiveFocus} onStop={() => localParticipant?.setScreenShareEnabled(false)} /></div>
        ) : (
          <FocusLayout trackRef={effectiveFocus} className="flex-1 min-w-0 min-h-0"><ParticipantTileWithHandRaise handRaisedByIdentity={handRaisedByIdentity} /></FocusLayout>
        )}
      </FocusLayoutContainer>
      </TileActionsContext.Provider>
      {availablePinnedFocus && (
        <div className="mfocusbar">
          <Button type="button" variant="secondary" size="sm" onClick={leaveLargeView}>
            {layout === 'speaker' ? <Trans>Back to speaker view</Trans> : <Trans>Back to grid</Trans>}
          </Button>
          {pinnedByUser && <span className="tile__name mfocusbar__tag"><Pin className="icon" aria-hidden="true" /><Trans>Pinned for you</Trans></span>}
        </div>
      )}
      {localPip}
      {sheet}
    </div>
  );
};

export const LiveKitVideoArea: React.FC<LiveKitVideoAreaProps> = (props) => {
  const camera = useCameraSwitch();
  return (
    <div className="contents" data-rear-camera={camera.isRearCamera}>
      <VideoStage {...props} camera={camera} />
      {camera.failed && (
        <div role="alert" className="toast mtoast"><Trans>The camera could not be switched. Try again, or pick one in Settings.</Trans></div>
      )}
    </div>
  );
};
