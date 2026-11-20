
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import type { BoardFocus } from '../components/Whiteboard';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { X } from 'lucide-react';
import {
  LayoutContextProvider,
  LiveKitRoom,
  RoomAudioRenderer,
  useCreateLayoutContext,
  useRoomContext,
} from '@livekit/components-react';
import { ScreenSharePresets, VideoPresets } from 'livekit-client';
import '@livekit/components-styles';
import { useAction, useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { IconButton, Notice } from '../components/ui';
import { MeetingDoc } from '../components/MeetingDoc';
import { useColorMode } from '../hooks/useColorMode';
import { MeetingFallback } from './MeetingFallback';
import { MeetingEndReason, MeetingSummary, User, UserRole, type WhiteboardElement } from '../types';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  BreakoutRoomsPanel,
  ConnectionStatusOverlay,
  InitialDeviceSetup,
  LKControls,
  TranscriptPanel,
  LiveKitVideoArea,
  PeopleList,
  SettingsModal,
  BreakoutConnectionCoordinator,
  DeviceHandoffDialog,
} from './meeting';
import { withoutError } from '../hooks/useQueryResult';
import { ScreenShareToast } from './meeting/ScreenShareToast';
import { useMeetingQuery } from './meeting/useMeetingQuery';
import { ParticipantCount } from './meeting/PeopleList';
import { MeetingRoomContext } from './meeting/MeetingRoomContext';
import { SessionNotes } from './meeting/sessions/SessionNotes';
import { AssistantOverlay } from './meeting/assistant/AssistantOverlay';
import { useSessionSummary } from './meeting/sessions/useSessionSummary';
import { getJoinMediaPublishConfig } from './meeting/joinMedia';
import { MeetingParticipantTracker, buildMeetingSummary } from './meeting/meetingSummary';
import {
  buildAudioCaptureOptions,
  getNoiseReductionSupport,
  readNoiseReductionPreference,
  writeNoiseReductionPreference,
} from './meeting/audioCapture';
import {
  AudioProcessingManager,
  BackgroundProcessorManager,
  DEFAULT_BACKGROUND_PROCESSOR_DEBUG_INFO,
  type BackgroundProcessorDebugInfo,
} from './meeting/mediaProcessing';
import { EffectsPanel, type BackgroundOption } from './meeting/EffectsPanel';
import { MeetingTopBar } from './meeting/MeetingTopBar';
import { LeaveMeetingDialog } from './meeting/LeaveMeetingDialog';
import { useWhiteboardSync } from './meeting/useWhiteboardSync';
import { useDeviceHandoff } from './meeting/useDeviceHandoff';
import { ChatPanel } from './meeting/chat/ChatPanel';
import { useChat } from './meeting/chat/useChat';

interface MeetingProps {
  currentUser: User;
  onLeave: (summary?: MeetingSummary) => void;
  meetingNotes: string;
  onUpdateNotes: (notes: string) => void;
  initialMuted?: boolean;
  initialCameraOff?: boolean;
  initialNoiseReductionEnabled?: boolean;
  initialVirtualBackground?: string;
  initialAudioInputDeviceId?: string;
  initialVideoInputDeviceId?: string;
  initialAudioOutputDeviceId?: string;
  livekitToken?: string;
  livekitUrl?: string;
  roomId?: string;
  roomSlug?: string;
  sessionCredential?: string;
  roomAccessToken?: string;
  livekitRoomName?: string;
  breakoutMode?: 'native' | 'reconnect';
  initialCurrentRoomId?: string;
  onTransferred?: () => void;
}

// The stage folds here, the same width as the 60rem fold in styles/system.css and styles/meeting.css.
const STAGE_FOLD_QUERY = '(max-width: 60rem)';

const E2ERoomHook: React.FC<{ onRoomNameChange?: (name: string) => void }> = ({ onRoomNameChange }) => {
  const room = useRoomContext();

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__lkRoom = room;
    }
  }, [room]);

  useEffect(() => {
    if (room.name) onRoomNameChange?.(room.name);
  }, [onRoomNameChange, room.name]);

  return null;
};


// Main Meeting component
export const Meeting: React.FC<MeetingProps> = ({
  currentUser,
  onLeave,
  meetingNotes,
  onUpdateNotes,
  initialMuted,
  initialCameraOff,
  initialNoiseReductionEnabled,
  initialVirtualBackground,
  initialAudioInputDeviceId,
  initialVideoInputDeviceId,
  initialAudioOutputDeviceId,
  livekitToken,
  livekitUrl,
  roomId,
  roomSlug,
  sessionCredential,
  roomAccessToken,
  livekitRoomName,
  breakoutMode,
  initialCurrentRoomId,
  onTransferred,
}) => {
  const layoutContext = useCreateLayoutContext();
  const isE2ESim = import.meta.env.DEV && new URLSearchParams(window.location.search).has('e2eSim');
  const roomResult = useMeetingQuery(api.rooms.getBySlug, !isE2ESim && roomSlug ? { slug: roomSlug } : "skip");
  const room = withoutError(roomResult);
  const roomLoading = !isE2ESim && roomResult === undefined && roomSlug !== undefined;
  const partnerLogoUrl = room?.branding?.logoUrl;
  const roomName = room?.name || t`Meeting`;

  // Layout state
  const [activeTab, setActiveTab] = useState<'none' | 'chat' | 'people' | 'notes' | 'effects' | 'breakout' | 'transcript'>('none');
  const [breakoutRooms, setBreakoutRooms] = useState<import('../types').BreakoutRoom[]>([]);
  const [isBreakoutActive, setIsBreakoutActive] = useState(false);
  const [currentBreakoutRoomId, setCurrentBreakoutRoomId] = useState<string | null>(initialCurrentRoomId && initialCurrentRoomId !== 'main' ? initialCurrentRoomId : null);
  const [requestedBreakoutRoomId, setRequestedBreakoutRoomId] = useState<string | null>(null);
  const [layout, setLayout] = useState<'grid' | 'speaker'>('grid');
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.matchMedia(STAGE_FOLD_QUERY).matches : false);
  const { darkMode, toggleDarkMode } = useColorMode();
  const [isNoiseReductionEnabled, setIsNoiseReductionEnabled] = useState(() => {
    if (typeof initialNoiseReductionEnabled === 'boolean') {
      return initialNoiseReductionEnabled;
    }
    return readNoiseReductionPreference(true);
  });
  const [isNoiseReductionSupported, setIsNoiseReductionSupported] = useState(() => getNoiseReductionSupport().supported);

  // Doc state
  const [isDocLocked, setIsDocLocked] = useState(false);
  const [isDocExpanded, setIsDocExpanded] = useState(false);

  // Video effects
  const [virtualBackground, setVirtualBackground] = useState(initialVirtualBackground || 'none');
  const hasHydratedJoinEffectsRef = useRef(false);
  const [customBackgrounds, setCustomBackgrounds] = useState<BackgroundOption[]>([]);
  const [backgroundProcessorError, setBackgroundProcessorError] = useState<string | null>(null);
  const [backgroundProcessingSupported, setBackgroundProcessingSupported] = useState(true);
  const [backgroundProcessorDebugInfo, setBackgroundProcessorDebugInfo] = useState<BackgroundProcessorDebugInfo>(
    DEFAULT_BACKGROUND_PROCESSOR_DEBUG_INFO,
  );
  const debugBgEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugBg') === '1';

  useEffect(() => {
    if (hasHydratedJoinEffectsRef.current) return;
    if (initialVirtualBackground === undefined) return;
    setVirtualBackground(initialVirtualBackground || 'none');
    hasHydratedJoinEffectsRef.current = true;
  }, [initialVirtualBackground]);

  useEffect(() => {
    setIsNoiseReductionSupported(getNoiseReductionSupport().supported);
  }, []);

  useEffect(() => {
    writeNoiseReductionPreference(isNoiseReductionEnabled);
  }, [isNoiseReductionEnabled]);

  // Convex queries/mutations
  const docResult = useMeetingQuery(api.meetingDoc.get, roomId ? { roomId, accessToken: roomAccessToken } : "skip");
  const doc = withoutError(docResult);
  const docFailed = docResult instanceof Error;
  const saveDoc = useMutation(api.meetingDoc.save);
  const setDocLockMutation = useMutation(api.meetingDoc.setLocked);
  const whiteboardResult = useMeetingQuery(api.whiteboard.get, roomId ? { roomId, accessToken: roomAccessToken } : "skip");
  const whiteboardSnapshot = withoutError(whiteboardResult);
  const whiteboardFailed = whiteboardResult instanceof Error;
  const chat = useChat({ roomId, roomAccessToken, isOpen: activeTab === 'chat' });
  const assistantEdits = withoutError(useMeetingQuery(api.assistant.recent, roomId ? { roomId: roomId as any, accessToken: roomAccessToken } : 'skip'));
  const assistantBlocks = useMemo(
    () => (assistantEdits ?? []).flatMap(edit => (edit.kind === 'notes' && edit.blockId && edit.html
      ? [{ blockId: edit.blockId, html: edit.html, createdAt: edit.createdAt, undone: !!edit.undoneAt }]
      : [])),
    [assistantEdits],
  );
  // What the assistant changed on the board comes into view; a view it was asked for opens the board.
  const [boardFocus, setBoardFocus] = useState<BoardFocus | undefined>();
  const seenEditsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!assistantEdits) return;
    if (!seenEditsRef.current) {
      seenEditsRef.current = new Set(assistantEdits.map(edit => edit.id));
      return;
    }
    const seen = seenEditsRef.current;
    const fresh = assistantEdits.find(edit => !seen.has(edit.id) && !edit.undoneAt
      && (edit.kind === 'view' || (edit.kind === 'board' && edit.focusIds.length > 0)));
    for (const edit of assistantEdits) seen.add(edit.id);
    if (!fresh) return;
    setBoardFocus({
      key: fresh.id, ids: fresh.focusIds, mode: fresh.kind === 'view' ? (fresh.view as BoardFocus['mode'] | null) ?? 'fit' : 'reveal',
      // Everyone sees the assistant's cursor where it just wrote.
      by: fresh.kind === 'board' ? 'Vivo' : undefined,
    });
    if (fresh.kind === 'view') setIsWhiteboardOpen(true);
  }, [assistantEdits]);
  const { whiteboardError, handleWhiteboardCommit } = useWhiteboardSync(roomId, roomAccessToken);
  const meetingRoom = useMemo(
    () => (roomId ? { roomId, accessToken: roomAccessToken, roomSlug } : null),
    [roomId, roomAccessToken, roomSlug],
  );
  const currentRecording = withoutError(useMeetingQuery(api.recordings.currentForRoom, roomId ? { roomId: roomId as any, accessToken: roomAccessToken } : "skip"));
  const transcriptResult = useMeetingQuery(
    api.recordings.latestTranscriptForRoom,
    roomId ? { roomId: roomId as any, accessToken: roomAccessToken } : 'skip',
  );
  const transcript = withoutError(transcriptResult) as any;
  const transcriptFailed = transcriptResult instanceof Error;
  const billing = withoutError(useMeetingQuery(api.billing.getForOrg,
    room?.orgId && roomId && (currentUser.role === UserRole.HOST || currentUser.role === UserRole.ADMIN)
      ? { roomId: roomId as Id<'rooms'> } : 'skip',
  ));
  const endMeetingForAll = useAction(api.meetingActions.endForAll);
  const startRecording = useAction(api.recordingActions.start);
  const stopRecording = useAction(api.recordingActions.stop);
  const presenceList = withoutError(useMeetingQuery(api.presence.listForRoom, roomId ? { roomId: roomId as any, accessToken: roomAccessToken } : "skip"));
  const setHandRaised = useMutation(api.presence.setHandRaised);
  const heartbeatPresence = useMutation(api.presence.heartbeat);
  const breakoutSession = withoutError(useMeetingQuery(api.breakouts.getForRoom, roomId ? { roomId: roomId as any, accessToken: roomAccessToken } : 'skip')) as any;
  const startBreakout = useMutation(api.breakouts.start);
  const endBreakout = useMutation(api.breakouts.end);
  const [currentLivekitRoomName, setCurrentLivekitRoomName] = useState(livekitRoomName ?? roomSlug ?? '');
  const handoff = useDeviceHandoff({ roomId, sessionCredential, currentBreakoutRoomId, currentLivekitRoomName });
  const [breakoutError, setBreakoutError] = useState<string | null>(null);
  const breakoutParticipantNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const presence of presenceList ?? []) {
      if (presence.userId && presence.userName) names[presence.userId] = presence.userName;
    }
    for (const assignment of breakoutSession?.assignments ?? []) {
      if (assignment.identity && assignment.name) names[assignment.identity] = assignment.name;
    }
    names[currentUser.id] = currentUser.name;
    return names;
  }, [breakoutSession?.assignments, currentUser.id, currentUser.name, presenceList]);

  // Loading/error states
  const docLoading = roomId ? docResult === undefined : false;
  const [docError, setDocError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<{
    roomId: string; html: string; revision: string; savedFrom?: string | null;
  } | null>(null);
  const notesPending = useRef<Parameters<typeof saveDoc>[0] | null>(null);
  const notesSaving = useRef(false);
  const notesFailedBase = useRef<{ revision: string; base: string | null } | null>(null);
  const notesSaveTimer = useRef<number | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingLoading, setRecordingLoading] = useState(false);

  // Sync doc lock state
  useEffect(() => {
    if (doc?.locked !== undefined) setIsDocLocked(doc.locked);
  }, [doc?.locked]);

  useEffect(() => {
    if (breakoutSession === undefined) return;
    if (!breakoutSession) {
      setIsBreakoutActive(false);
      setCurrentBreakoutRoomId(null);
      return;
    }
    setIsBreakoutActive(breakoutSession.status === 'active');
    setBreakoutRooms(
      breakoutSession.rooms.map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        participantIds: breakoutSession.assignments
          .filter((assignment: any) => assignment.roomId === entry.id)
          .map((assignment: any) => assignment.identity),
      })),
    );
  }, [breakoutSession]);

  const myHandRaised = presenceList?.find((p) => p.userId === currentUser.id)?.handRaised ?? false;
  const handRaisedByIdentity = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (presenceList) {
      for (const p of presenceList) {
        map[p.userId] = p.handRaised;
      }
    }
    return map;
  }, [presenceList]);

  useEffect(() => {
    if (!roomId) return;
    const tick = () => {
      // Presence is self-healing on the next tick; do not surface a transient timeout as an unhandled rejection.
      void heartbeatPresence({ roomId: roomId as any, userId: currentUser.id, userName: currentUser.name, accessToken: roomAccessToken }).catch(() => undefined);
    };
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, [roomId, roomAccessToken, currentUser.id, currentUser.name, heartbeatPresence]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => setIsMobile(window.matchMedia(STAGE_FOLD_QUERY).matches);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const docContent = doc?.contentHtml ?? meetingNotes;
  // The mutation can resolve before React renders its query update. Keep the local
  // draft until the query moves past the revision that this save replaced.
  const draft = notesDraft && notesDraft.roomId === roomId
    && (notesDraft.savedFrom === undefined || notesDraft.savedFrom === (doc?.revision ?? null)) ? notesDraft : null;
  const editorContent = draft?.html ?? docContent;
  const editorRevision = draft?.revision ?? doc?.revision ?? null;

  // Endscreen snapshot: the session start, everyone seen, and a guard so a
  // disconnect event and an explicit leave cannot both fire the exit.
  const startedAtRef = useRef(Date.now());
  const seenParticipantsRef = useRef<Set<string>>(new Set());
  const hasLeftRef = useRef(false);
  const [showLeaveOptions, setShowLeaveOptions] = useState(false);
  const [endingForAll, setEndingForAll] = useState(false);
  const [endForAllError, setEndForAllError] = useState<string | null>(null);
  const canEndForAll =
    !isE2ESim && !!roomId && (currentUser.role === UserRole.HOST || currentUser.role === UserRole.ADMIN);

  const { currentFrom: sessionFrom, ...sessionSummary } = useSessionSummary(roomId, roomAccessToken);
  const handleLeave = useCallback(
    (reason: MeetingEndReason = 'left') => {
      if (hasLeftRef.current) return;
      hasLeftRef.current = true;
      onLeave(
        buildMeetingSummary({
          roomName: room?.name,
          roomSlug,
          startedAt: startedAtRef.current,
          endedAt: Date.now(),
          participantNames: seenParticipantsRef.current,
          chatMessageCount: (chat.messages ?? []).filter(message => message.timestamp >= sessionFrom).length,
          hadNotes: !!docContent && docContent.replace(/<[^>]*>/g, '').trim().length > 0,
          hadRecording: !!currentRecording,
          reason,
          board: whiteboardSnapshot?.elements as WhiteboardElement[] | undefined,
          ...sessionSummary,
        }),
      );
    },
    [onLeave, whiteboardSnapshot?.elements, room?.name, roomSlug, chat.messages, sessionFrom, docContent, currentRecording, sessionSummary.sessionId, sessionSummary.hadBoard, sessionSummary.canOpenHistory],
  );

  const handleEndForAll = useCallback(async () => {
    if (!roomId) return;
    setEndingForAll(true);
    setEndForAllError(null);
    try {
      await endMeetingForAll({ roomId: roomId as any });
      setShowLeaveOptions(false);
      // Closing the LiveKit room disconnects this client too, but do not wait
      // for the event to route the host away.
      handleLeave('host_ended');
    } catch (err: any) {
      setEndForAllError(
        (typeof err?.data === 'string' && err.data) || err?.message || t`Could not end the meeting for everyone.`,
      );
    } finally {
      setEndingForAll(false);
    }
  }, [roomId, endMeetingForAll, handleLeave]);

  const toggleTab = (tab: 'chat' | 'people' | 'notes' | 'effects' | 'breakout' | 'transcript') => {
    setActiveTab(prev => {
      const next = prev === tab ? 'none' : tab;
      if (tab === 'notes' && next === 'notes') {
        setIsWhiteboardOpen(false);
        setIsDocExpanded(false);
      }
      if (tab === 'chat' && next === 'chat') chat.markRead();
      return next;
    });
  };

  const toggleHandRaise = async () => {
    if (!roomId) return;
    try {
      await setHandRaised({
        roomId: roomId as any,
        userId: currentUser.id,
        userName: currentUser.name,
        raised: !myHandRaised,
        accessToken: roomAccessToken,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Meeting] Failed to update hand raise', err);
    }
  };

  const handleToggleRecording = async () => {
    if (!roomId) return;
    setRecordingLoading(true);
    setRecordingError(null);
    try {
      const status = (currentRecording as any)?.status;
      if (currentRecording && status === 'recording') {
        await stopRecording({ recordingId: (currentRecording as any).id });
      } else if (currentRecording && status === 'starting') {
        return;
      } else if (room?.orgId && billing?.planId === 'free') {
        setRecordingError(t`Recording requires a paid workspace plan. Upgrade to Pro to enable it.`);
      } else {
        await startRecording({ roomId: roomId as any });
      }
    } catch (err: any) {
      setRecordingError(err?.message || t`Recording error`);
    } finally {
      setRecordingLoading(false);
    }
  };

  const flushNotes = useCallback(async () => {
    if (notesSaveTimer.current !== null) window.clearTimeout(notesSaveTimer.current);
    notesSaveTimer.current = null;
    const pending = notesPending.current;
    if (!pending?.edit || notesSaving.current) return;
    notesPending.current = null;
    notesSaving.current = true;
    const { revision, base } = pending.edit;
    try {
      await saveDoc(pending);
      setNotesDraft(current => current?.revision === revision ? { ...current, savedFrom: base } : current);
      setDocError(null);
    } catch (error) {
      notesFailedBase.current = { revision, base };
      const newer = notesPending.current as typeof pending | null;
      if (newer?.edit?.base === revision) newer.edit.base = base;
      setDocError(error instanceof ConvexError && error.data === 'NOTES_CONFLICT'
        ? t`Someone else updated the notes. Copy or download your draft before reloading.`
        : t`Unable to save notes.`);
    } finally {
      notesSaving.current = false;
      if (notesPending.current && notesSaveTimer.current === null) void flushNotes();
    }
  }, [saveDoc]);

  useEffect(() => () => { void flushNotes(); }, [flushNotes]);

  const handleDocUpdate = (html: string, seenAssistantIds: string[], base: string | null) => {
    onUpdateNotes(html);
    if (!roomId) return null;

    const queued = notesPending.current?.edit;
    const failed = notesFailedBase.current;
    const revision = queued?.revision ?? crypto.randomUUID();
    notesPending.current = {
      roomId, contentHtml: html, accessToken: roomAccessToken, seenAssistantIds,
      edit: { base: queued ? queued.base : failed?.revision === base ? failed.base : base, revision },
    };
    setNotesDraft({ roomId, html, revision });
    if (notesSaveTimer.current !== null) window.clearTimeout(notesSaveTimer.current);
    notesSaveTimer.current = window.setTimeout(() => { void flushNotes(); }, 1000);
    return revision;
  };

  const handleToggleLock = async () => {
    const next = !isDocLocked;
    setIsDocLocked(next);
    if (roomId) {
      try {
        await setDocLockMutation({ roomId, locked: next });
      } catch {
        // #COMPLETION_DRIVE: Setting hardcoded error message
        // #SUGGEST_VERIFY: Use useLingui hook for dynamic error messages
        setDocError(t`Unable to update lock.`);
      }
    }
  };

  const handleStartBreakout = async (draftRooms: import('../types').BreakoutRoom[]) => {
    if (!roomId) return;
    setBreakoutError(null);
    try {
      await startBreakout({
        roomId: roomId as any,
        roomCount: draftRooms.length,
        rooms: draftRooms.map((entry) => ({
          id: entry.id,
          name: entry.name,
          participantIds: entry.participantIds,
        })),
        assignments: draftRooms.flatMap((entry) => entry.participantIds.map((identity) => ({
          identity,
          name: breakoutParticipantNames[identity] || identity,
          roomId: entry.id,
        }))),
      });
    } catch (error) {
      setBreakoutError(error instanceof Error ? error.message : 'Unable to start breakout rooms.');
    }
  };

  const handleEndBreakout = async () => {
    if (!roomId) return false;
    setBreakoutError(null);
    try {
      await endBreakout({ roomId: roomId as any });
      return true;
    } catch (error) {
      setBreakoutError(error instanceof Error ? error.message : 'Unable to end breakout rooms.');
      return false;
    }
  };

  // Hooks must stay above the early returns below; the room query can briefly reload mid-meeting.
  const micAudioCaptureOptions = useMemo(
    () =>
      buildAudioCaptureOptions({
        noiseReductionEnabled: isNoiseReductionEnabled,
        deviceId: initialAudioInputDeviceId,
      }),
    [isNoiseReductionEnabled, initialAudioInputDeviceId],
  );

  // Loading state
  if (roomLoading) {
    return (
      <div className="g-board h-[100dvh] w-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-board-muted">
          <span className="spin" aria-hidden="true" />
          <span><Trans>Loading room...</Trans></span>
        </div>
      </div>
    );
  }

  if (!isE2ESim && roomSlug && room === null) {
    return <MeetingFallback onLeave={() => onLeave()} />;
  }

  const canControlRecording = currentUser.role === UserRole.HOST || currentUser.role === UserRole.ADMIN;
  const recordingStatus = (currentRecording as any)?.status;
  const isRecording = recordingStatus === 'recording' || recordingStatus === 'starting';
  const effectiveInitialMuted = initialMuted ?? currentUser.isMuted;
  const effectiveInitialCameraOff = initialCameraOff ?? currentUser.isCameraOff;
  const joinMediaPublish = getJoinMediaPublishConfig({
    isMuted: effectiveInitialMuted,
    isCameraOff: effectiveInitialCameraOff,
    noiseReductionEnabled: isNoiseReductionEnabled,
    audioInputDeviceId: initialAudioInputDeviceId,
  });

  const panelOpen = activeTab !== 'none' && !isDocExpanded;
  // MeetingDoc heads its own sheet, because the lock and expand controls are its own.
  const notesDrawsOwnHead = activeTab === 'notes' && !docLoading;

  const effectiveToken = isE2ESim ? 'e2e-sim' : livekitToken;
  const effectiveUrl = isE2ESim ? 'ws://e2e-sim' : livekitUrl;

  // Fallback if no LiveKit credentials
  if (!effectiveToken || !effectiveUrl) {
    return <MeetingFallback onLeave={() => onLeave()} />;
  }

  return (
    <MeetingRoomContext.Provider value={meetingRoom}>
    <LiveKitRoom
      serverUrl={effectiveUrl}
      token={effectiveToken}
      audio={isE2ESim ? false : joinMediaPublish.audio}
      video={isE2ESim ? false : joinMediaPublish.video}
      options={{
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
        // The default second layer is 540p, which a laptop's large tile stretches and small print blurs.
        publishDefaults: { screenShareSimulcastLayers: [ScreenSharePresets.h720fps15] },
      }}
      connect={!isE2ESim}
      className="meet g-board relative overflow-hidden"
      data-lk-theme="default"
    >
      <RoomAudioRenderer />
      <MeetingParticipantTracker seenRef={seenParticipantsRef} />
      <E2ERoomHook onRoomNameChange={setCurrentLivekitRoomName} />
      {!isE2ESim && <ConnectionStatusOverlay
          darkMode={darkMode}
          onLeave={handleLeave}
          roomId={roomId}
          sessionCredential={sessionCredential}
          currentRoomId={currentBreakoutRoomId ?? 'main'}
          onTransferred={onTransferred}
        />}
      {!isE2ESim && (
        <BreakoutConnectionCoordinator
          roomId={roomId}
          parentLivekitRoomName={livekitRoomName ?? roomSlug ?? ''}
          identity={currentUser.id}
          sessionCredential={sessionCredential}
          roomAccessToken={roomAccessToken}
          breakoutMode={breakoutMode}
          initialCurrentRoomId={initialCurrentRoomId}
          isManager={currentUser.role === UserRole.HOST || currentUser.role === UserRole.ADMIN}
          requestedRoomId={requestedBreakoutRoomId}
          onRequestHandled={() => setRequestedBreakoutRoomId(null)}
          onRoomChanged={(nextRoomId) => setCurrentBreakoutRoomId(nextRoomId === 'main' ? null : nextRoomId)}
          onError={setBreakoutError}
          onNotice={(message) => setBreakoutError(message)}
        />
      )}

      {!isE2ESim && (
        <InitialDeviceSetup
          audioInputDeviceId={initialAudioInputDeviceId}
          videoInputDeviceId={initialVideoInputDeviceId}
          audioOutputDeviceId={initialAudioOutputDeviceId}
        />
      )}
      <AudioProcessingManager
        audioOptions={micAudioCaptureOptions}
        noiseReductionEnabled={isNoiseReductionEnabled}
      />

      {/* Background Processor Manager */}
      <BackgroundProcessorManager
        virtualBackground={virtualBackground}
        onError={setBackgroundProcessorError}
        onSupportChange={setBackgroundProcessingSupported}
        onDebugChange={setBackgroundProcessorDebugInfo}
      />

      <SettingsModal
        show={showSettings}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        noiseReductionEnabled={isNoiseReductionEnabled}
        noiseReductionSupported={isNoiseReductionSupported}
        onNoiseReductionChange={setIsNoiseReductionEnabled}
        onOpenHandoff={() => { setShowSettings(false); handoff.openDeviceHandoff(); }}
        onClose={() => setShowSettings(false)}
      />

      <DeviceHandoffDialog
        show={handoff.showHandoff}
        darkMode={darkMode}
        code={handoff.handoffCode}
        expiresAt={handoff.handoffExpiresAt}
        loading={handoff.handoffLoading}
        error={handoff.handoffError}
        onCreate={() => void handoff.createDeviceHandoff()}
        onCancel={() => void handoff.cancelDeviceHandoff()}
        onClose={handoff.closeHandoff}
      />

      {/* Screen share toast */}
      <ScreenShareToast />
      {roomId && <AssistantOverlay edits={assistantEdits} />}

      {/* Expanded Doc Overlay */}
      {activeTab === 'notes' && isDocExpanded && !docFailed && (
        <SessionNotes
          saveFailed={Boolean(docError) || !!draft}
          mode="fullscreen"
          onClose={() => { setIsDocExpanded(false); setActiveTab('none'); }}
          initialContent={editorContent}
          contentRevision={editorRevision}
          hasDraft={!!draft}
          contentChangedAt={doc?.changedAt ?? null}
          assistantBlocks={assistantBlocks}
          onUpdate={handleDocUpdate}
          currentUser={currentUser}
          isLocked={isDocLocked}
          onToggleLock={handleToggleLock}
          darkMode={darkMode}
          onToggleExpand={() => setIsDocExpanded(false)}
        />
      )}

      <LayoutContextProvider value={layoutContext}>
        <MeetingTopBar
          roomName={roomName}
          startedAt={startedAtRef.current}
          partnerLogoUrl={partnerLogoUrl}
          isRecording={isRecording}
          isBreakoutActive={isBreakoutActive}
          myHandRaised={myHandRaised}
          layout={layout}
          onLayoutChange={(next) => {
            setLayout(next);
            if (next === 'grid') layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
          }}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          onOpenSettings={() => setShowSettings(true)}
        />

        {/* Main Layout */}
        <div className={`meet__mid ${panelOpen ? 'meet__mid--panel' : ''} ${isWhiteboardOpen ? 'meet__mid--board' : ''}`}>
          <div className="stage">
            <LiveKitVideoArea
              layout={layout}
              layoutContext={layoutContext}
              isWhiteboardOpen={isWhiteboardOpen}
              whiteboardElements={whiteboardSnapshot?.elements}
              whiteboardFocus={boardFocus}
              onWhiteboardCommit={handleWhiteboardCommit}
              onWhiteboardClose={() => setIsWhiteboardOpen(false)}
              whiteboardFailed={whiteboardFailed}
              isMobile={isMobile}
              handRaisedByIdentity={handRaisedByIdentity}
              darkMode={darkMode}
              compact={isMobile && panelOpen}
            />
          </div>

          {/* The sheet on the board follows the mode */}
          {panelOpen && (
            <aside
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !e.defaultPrevented) setActiveTab('none');
              }}
              className="panel stock mpanel"
              aria-label={
                activeTab === 'chat' ? t`Chat`
                : activeTab === 'people' ? t`Participants`
                : activeTab === 'notes' ? t`Notes`
                : activeTab === 'effects' ? t`Effects`
                : activeTab === 'breakout' ? t`Breakout Rooms`
                : t`Transcript`
              }
            >
              {!notesDrawsOwnHead && (
                <div className="panel__head">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <h2 className="panel__title">
                      {activeTab === 'chat' && <Trans>Chat</Trans>}
                      {activeTab === 'people' && <Trans>Participants</Trans>}
                      {activeTab === 'notes' && <Trans>Notes</Trans>}
                      {activeTab === 'effects' && <Trans>Effects</Trans>}
                      {activeTab === 'breakout' && <Trans>Breakout Rooms</Trans>}
                      {activeTab === 'transcript' && <Trans>Transcript</Trans>}
                    </h2>
                    {activeTab === 'people' && <ParticipantCount />}
                  </span>
                  <IconButton label={t`Close panel`} onClick={() => setActiveTab('none')}>
                    <X className="icon" aria-hidden="true" />
                  </IconButton>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-hidden">
                {activeTab === 'notes' && (
                  docFailed ? (
                    <div className="mquiet"><Notice variant="error"><Trans>Notes could not be loaded. Leave the meeting and join again to retry.</Trans></Notice></div>
                  ) : docLoading ? (
                    <div className="mquiet"><p className="empty__title"><Trans>Loading notes...</Trans></p></div>
                  ) : (
                    <SessionNotes
                      saveFailed={Boolean(docError) || !!draft}
                      mode="sidebar"
                      onClose={() => setActiveTab('none')}
                      initialContent={editorContent}
                      contentRevision={editorRevision}
                      hasDraft={!!draft}
                      contentChangedAt={doc?.changedAt ?? null}
                      assistantBlocks={assistantBlocks}
                      onUpdate={handleDocUpdate}
                      currentUser={currentUser}
                      isLocked={isDocLocked}
                      onToggleLock={handleToggleLock}
                      darkMode={darkMode}
                      onToggleExpand={() => setIsDocExpanded(true)}
                    />
                  )
                )}

                {activeTab === 'chat' && (
                  <ChatPanel chat={chat} roomId={roomId} roomAccessToken={roomAccessToken} userName={currentUser.name} darkMode={darkMode} />
                )}

                {activeTab === 'people' && <PeopleList handRaisedByIdentity={handRaisedByIdentity} darkMode={darkMode} />}

                {activeTab === 'transcript' && (
                  <TranscriptPanel
                    transcript={transcript}
                    loading={Boolean(roomId) && transcriptResult === undefined}
                    failed={transcriptFailed}
                    darkMode={darkMode}
                  />
                )}

                {activeTab === 'breakout' && (
                  <BreakoutRoomsPanel
                    breakoutRooms={breakoutRooms}
                    isBreakoutActive={isBreakoutActive}
                    currentBreakoutRoomId={currentBreakoutRoomId}
                    currentUser={currentUser}
                    participantNames={breakoutParticipantNames}
                    darkMode={darkMode}
                    onStartSession={handleStartBreakout}
                    onEndSession={handleEndBreakout}
                    onJoinRoom={(nextRoomId) => setRequestedBreakoutRoomId(nextRoomId ?? 'main')}
                  />
                )}

                {activeTab === 'effects' && (
                  <EffectsPanel
                    virtualBackground={virtualBackground}
                    onSelectBackground={setVirtualBackground}
                    customBackgrounds={customBackgrounds}
                    onAddCustomBackground={(option) => setCustomBackgrounds(prev => [...prev, option])}
                    backgroundProcessingSupported={backgroundProcessingSupported}
                    backgroundProcessorError={backgroundProcessorError}
                    debugInfo={debugBgEnabled ? backgroundProcessorDebugInfo : null}
                    noiseReductionEnabled={isNoiseReductionEnabled}
                    noiseReductionSupported={isNoiseReductionSupported}
                    onNoiseReductionChange={setIsNoiseReductionEnabled}
                  />
                )}
              </div>
            </aside>
          )}
        </div>
      </LayoutContextProvider>

      {/* Footer Control Bar */}
      <div className="meet__bar">
        <LKControls
          activeTab={activeTab}
          isHandRaised={myHandRaised}
          isWhiteboardOpen={isWhiteboardOpen}
          isRecording={isRecording}
          canControlRecording={canControlRecording}
          recordingLoading={recordingLoading}
          recordingStarting={recordingStatus === 'starting'}
          darkMode={darkMode}
          initialMuted={effectiveInitialMuted}
          initialCameraOff={effectiveInitialCameraOff}
          audioCaptureOptions={micAudioCaptureOptions}
          unreadCount={chat.unreadCount}
          onToggleTab={toggleTab}
          onToggleHandRaise={toggleHandRaise}
          onToggleWhiteboard={() => { setIsWhiteboardOpen(!isWhiteboardOpen); if (activeTab === 'notes') setActiveTab('none'); }}
          onToggleRecording={handleToggleRecording}
          onLeave={canEndForAll ? () => setShowLeaveOptions(true) : () => handleLeave('left')}
          onOpenSettings={() => setShowSettings(true)}
          onOpenHandoff={handoff.openDeviceHandoff}
        />
      </div>

      <LeaveMeetingDialog
        isOpen={showLeaveOptions}
        ending={endingForAll}
        error={endForAllError}
        onClose={() => setShowLeaveOptions(false)}
        onLeave={() => handleLeave('left')}
        onEndForAll={() => void handleEndForAll()}
      />

      {/* Error Toast */}
      {(docError || recordingError || whiteboardError || breakoutError) && (
        <p role="alert" className="notice notice--error stock mtoast">
          {docError || recordingError || whiteboardError || breakoutError}
        </p>
      )}
    </LiveKitRoom>
    </MeetingRoomContext.Provider>
  );
};
