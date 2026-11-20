import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockTrackRef = {
  participant: { identity: string; name?: string; isLocal?: boolean; isSpeaking?: boolean };
  source: string;
  publication?: { source: string; trackSid: string; isSubscribed: boolean };
};

const liveKitMockState = vi.hoisted(() => ({
  tracks: [] as MockTrackRef[],
  pinState: [] as MockTrackRef[],
  carouselMounts: 0,
  localParticipant: { identity: 'alice', name: 'Alice', isLocal: true, setScreenShareEnabled: vi.fn() },
  gridMaxTiles: 2,
  camera: { canSwitch: false, isRearCamera: false, switching: false, failed: false, switchCamera: vi.fn() },
  pinDispatch: vi.fn((action: { msg: 'set_pin' | 'clear_pin'; trackReference?: MockTrackRef }) => {
    liveKitMockState.pinState.splice(0, liveKitMockState.pinState.length);
    if (action.msg === 'set_pin' && action.trackReference) liveKitMockState.pinState.push(action.trackReference);
  }),
}));

vi.mock('@lingui/react/macro', () => ({ Trans: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@lingui/core/macro', () => ({ t: (strings: TemplateStringsArray | string, ...values: unknown[]) => typeof strings === 'string' ? strings : strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, '') }));

vi.mock('@livekit/components-react', async () => {
  const ReactModule = await import('react');
  const TrackRefContext = ReactModule.createContext(undefined as MockTrackRef | undefined);
  return {
    LayoutContext: ReactModule.createContext(undefined),
    TrackRefContext,
    TrackLoop: ({ tracks, children }: { tracks: MockTrackRef[]; children: React.ReactNode }) => <>{tracks.map((track) => <TrackRefContext.Provider key={track.publication?.trackSid ?? `${track.participant.identity}-${track.source}-placeholder`} value={track}>{children}</TrackRefContext.Provider>)}</>,
    CarouselLayout: ({ children, className, orientation, tracks }: { children: React.ReactNode; className?: string; orientation?: string; tracks?: MockTrackRef[] }) => {
      const mountId = ReactModule.useRef(++liveKitMockState.carouselMounts).current;
      return <div data-testid="carousel-layout" data-mount-id={mountId} className={className} data-orientation={orientation}>{tracks?.map((track) => <TrackRefContext.Provider key={track.publication?.trackSid ?? `${track.participant.identity}-${track.source}-placeholder`} value={track}>{children}</TrackRefContext.Provider>)}</div>;
    },
    FocusLayoutContainer: ({ children, className }: { children: React.ReactNode; className?: string }) => <div data-testid="focus-layout-container" className={className}>{children}</div>,
    FocusLayout: ({ children, className, trackRef }: { children: React.ReactNode; className?: string; trackRef?: MockTrackRef }) => <div data-testid="focus-layout" className={className} data-track-sid={trackRef?.publication?.trackSid}><TrackRefContext.Provider value={trackRef}>{children}</TrackRefContext.Provider></div>,
    ParticipantTile: ({ className }: { className?: string }) => <div data-testid="participant-tile" className={className} />,
    VideoTrack: ({ className }: { className?: string }) => <video data-testid="video-track" className={className} />,
    useTrackRefContext: () => ReactModule.useContext(TrackRefContext),
    isTrackReference: (trackRef: MockTrackRef | undefined) => !!trackRef?.publication,
    usePinnedTracks: () => liveKitMockState.pinState,
    useTracks: () => liveKitMockState.tracks,
    useLocalParticipant: () => ({ localParticipant: liveKitMockState.localParticipant }),
    useGridLayout: () => ({ layout: { columns: 2, rows: 1, maxTiles: liveKitMockState.gridMaxTiles } }),
    usePagination: (maxTiles: number, tracks: MockTrackRef[]) => {
      const [currentPage, setCurrentPage] = ReactModule.useState(1);
      const totalPageCount = Math.max(1, Math.ceil(tracks.length / maxTiles));
      const page = Math.min(currentPage, totalPageCount);
      const start = (page - 1) * maxTiles;
      return { totalPageCount, currentPage: page, tracks: tracks.slice(start, start + maxTiles), nextPage: () => setCurrentPage((value) => Math.min(totalPageCount, value + 1)), prevPage: () => setCurrentPage((value) => Math.max(1, value - 1)), setPage: setCurrentPage };
    },
  };
});

vi.mock('./useCameraSwitch', () => ({
  useCameraSwitch: () => liveKitMockState.camera,
}));

import { LiveKitVideoArea } from './LiveKitVideoArea';

const createTrack = (source: string, sid: string, identity: string, options: Partial<MockTrackRef['participant']> = {}): MockTrackRef => ({
  participant: { identity, name: identity, isLocal: identity === 'alice', isSpeaking: false, ...options },
  source,
  publication: { source, trackSid: sid, isSubscribed: true },
});

const baseProps = () => ({
  layout: 'grid' as const,
  layoutContext: { pin: { state: liveKitMockState.pinState, dispatch: liveKitMockState.pinDispatch }, widget: { state: {}, dispatch: vi.fn() } } as any,
  isWhiteboardOpen: false,
  whiteboardElements: undefined,
  onWhiteboardCommit: vi.fn(),
  onWhiteboardClose: vi.fn(),
  isMobile: false,
  handRaisedByIdentity: {},
});

describe('LiveKitVideoArea', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice')];
    liveKitMockState.pinState = [];
    liveKitMockState.carouselMounts = 0;
    liveKitMockState.pinDispatch.mockClear();
    liveKitMockState.gridMaxTiles = 2;
    liveKitMockState.camera = { canSwitch: false, isRearCamera: false, switching: false, failed: false, switchCamera: vi.fn() };
    liveKitMockState.localParticipant.setScreenShareEnabled.mockClear();
  });

  it('keeps the call on screen and offers a way out when the whiteboard failed to load', () => {
    const props = { ...baseProps(), isWhiteboardOpen: true, whiteboardFailed: true };
    render(<LiveKitVideoArea {...props} />);

    expect(screen.getByRole('alert')).toHaveTextContent('The whiteboard could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onWhiteboardClose).toHaveBeenCalled();
  });

  it('returns to the page people were on after a panel folded the grid away', () => {
    liveKitMockState.tracks = ['a', 'b', 'c', 'd', 'e'].map((id) => createTrack('camera', `cam-${id}`, id));
    const props = { ...baseProps(), isMobile: true };
    const { rerender } = render(<LiveKitVideoArea {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByRole('status', { name: 'Current page' })).toHaveTextContent('2/3');

    rerender(<LiveKitVideoArea {...props} compact />);
    expect(screen.queryByRole('status', { name: 'Current page' })).not.toBeInTheDocument();

    rerender(<LiveKitVideoArea {...props} />);
    expect(screen.getByRole('status', { name: 'Current page' })).toHaveTextContent('2/3');
  });

  it('pins screenshare and clears the pin when sharing ends', () => {
    const props = baseProps();
    const { rerender } = render(<LiveKitVideoArea {...props} />);
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('screen_share', 'share-1', 'alice')];
    rerender(<LiveKitVideoArea {...props} />);
    expect(liveKitMockState.pinDispatch).toHaveBeenCalledWith({ msg: 'set_pin', trackReference: liveKitMockState.tracks[1] });
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice')];
    rerender(<LiveKitVideoArea {...props} />);
    expect(liveKitMockState.pinDispatch).toHaveBeenLastCalledWith({ msg: 'clear_pin' });
    expect(screen.getByTestId('grid-layout')).toBeInTheDocument();
  });

  it('uses centered grid rows and pagination markup', () => {
    liveKitMockState.gridMaxTiles = 3;
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob'), createTrack('camera', 'cam-3', 'cara', { isLocal: false }), createTrack('camera', 'cam-4', 'dave', { isLocal: false }), createTrack('camera', 'cam-5', 'erin', { isLocal: false })];
    render(<LiveKitVideoArea {...baseProps()} />);
    expect(screen.getByTestId('grid-layout')).toHaveAttribute('data-lk-pagination', 'true');
    expect(document.querySelectorAll('.lk-grid-row')).toHaveLength(2);
    expect(document.querySelectorAll('.lk-grid-row')[1].querySelectorAll('.lk-grid-tile-wrapper')).toHaveLength(1);
    expect(document.querySelector('.lk-pagination-control')).toHaveAttribute('data-lk-user-interaction', 'true');
  });

  it('sticks to a remote speaker and updates immediately for a new speaker', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false, isSpeaking: true })];
    const props = { ...baseProps(), layout: 'speaker' as const };
    const { rerender } = render(<LiveKitVideoArea {...props} />);
    expect(screen.getByTestId('focus-layout')).toHaveAttribute('data-track-sid', 'cam-2');
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false }), createTrack('camera', 'cam-3', 'cara', { isLocal: false, isSpeaking: true })];
    rerender(<LiveKitVideoArea {...props} />);
    expect(screen.getByTestId('focus-layout')).toHaveAttribute('data-track-sid', 'cam-3');
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false }), createTrack('camera', 'cam-3', 'cara', { isLocal: false })];
    rerender(<LiveKitVideoArea {...props} />);
    expect(screen.getByTestId('focus-layout')).toHaveAttribute('data-track-sid', 'cam-3');
  });

  it('renders local presenting placeholder and stops presentation', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('screen_share', 'share-1', 'alice')];
    liveKitMockState.pinState = [liveKitMockState.tracks[1]];
    render(<LiveKitVideoArea {...baseProps()} />);
    expect(screen.getByTestId('presenting-placeholder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop presenting' }));
    expect(liveKitMockState.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });

  it('always shows your own picture on a phone, and you can fold it to a pill and back', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false })];
    render(<LiveKitVideoArea {...baseProps()} isMobile />);
    expect(screen.getByTestId('local-pip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Minimize your camera' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize your camera' }));
    expect(screen.getByRole('button', { name: 'Expand your camera' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand your camera' }));
    expect(screen.getByRole('button', { name: 'Minimize your camera' })).toBeInTheDocument();

    cleanup();
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice')];
    render(<LiveKitVideoArea {...baseProps()} isMobile />);
    expect(screen.queryByTestId('local-pip')).not.toBeInTheDocument();
  });

  it('keeps you as a normal tile on a wide stage', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false })];
    render(<LiveKitVideoArea {...baseProps()} />);
    expect(screen.queryByTestId('local-pip')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('participant-tile')).toHaveLength(2);
  });

  it('turns the camera from your own picture when there is a second camera', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false })];
    render(<LiveKitVideoArea {...baseProps()} isMobile />);
    expect(screen.queryByRole('button', { name: 'Switch camera' })).not.toBeInTheDocument();

    cleanup();
    liveKitMockState.camera = { ...liveKitMockState.camera, canSwitch: true };
    render(<LiveKitVideoArea {...baseProps()} isMobile />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch camera' }));
    expect(liveKitMockState.camera.switchCamera).toHaveBeenCalled();
  });

  it('does not mirror the rear camera and says when turning failed', () => {
    liveKitMockState.camera = { ...liveKitMockState.camera, canSwitch: true, isRearCamera: true, failed: true };
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false })];
    render(<LiveKitVideoArea {...baseProps()} isMobile />);
    expect(document.querySelector('[data-rear-camera="true"]')).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('The camera could not be switched');
  });

  it('shows someone large from the tile and offers one way back', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false })];
    const { rerender } = render(<LiveKitVideoArea {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show bob large' }));
    expect(liveKitMockState.pinDispatch).toHaveBeenCalledWith(expect.objectContaining({ msg: 'set_pin' }));

    rerender(<LiveKitVideoArea {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to grid' }));
    expect(liveKitMockState.pinDispatch).toHaveBeenLastCalledWith({ msg: 'clear_pin' });
  });

  it('opens the same actions as a sheet when a tile is tapped', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false })];
    render(<LiveKitVideoArea {...baseProps()} isMobile />);
    fireEvent.click(screen.getByRole('button', { name: 'Options for bob' }));
    const sheet = screen.getByRole('dialog', { name: 'bob' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Show large' }));
    expect(liveKitMockState.pinDispatch).toHaveBeenCalledWith(expect.objectContaining({ msg: 'set_pin' }));
    expect(screen.queryByRole('dialog', { name: 'bob' })).not.toBeInTheDocument();
  });

  it('keeps your own pin when someone starts sharing, but a plain large view gives way', () => {
    const bob = createTrack('camera', 'cam-2', 'bob', { isLocal: false });
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), bob];
    const { rerender } = render(<LiveKitVideoArea {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin bob for me' }));
    rerender(<LiveKitVideoArea {...baseProps()} />);
    expect(screen.getByText('Pinned for you')).toBeInTheDocument();

    liveKitMockState.pinDispatch.mockClear();
    liveKitMockState.tracks = [...liveKitMockState.tracks, createTrack('screen_share', 'share-1', 'carol', { isLocal: false })];
    rerender(<LiveKitVideoArea {...baseProps()} />);
    expect(liveKitMockState.pinDispatch).not.toHaveBeenCalled();
  });

  it('lets you fill the frame only on the large tile, where the shapes differ', () => {
    const bob = createTrack('camera', 'cam-2', 'bob', { isLocal: false });
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), bob];
    expect(render(<LiveKitVideoArea {...baseProps()} />).queryByRole('button', { name: 'Fill the frame' })).toBeNull();
    cleanup();

    liveKitMockState.pinState = [bob];
    render(<LiveKitVideoArea {...baseProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fill the frame' }));
    expect(screen.getByTestId('focus-layout').querySelector('[data-fill="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Show the whole picture' })).toBeInTheDocument();
  });

  it('shows a raised hand as a word on the tile and offers the camera-off initial', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false, name: 'Bob Reyes' })];
    render(<LiveKitVideoArea {...baseProps()} handRaisedByIdentity={{ bob: true }} />);
    expect(screen.getByText('Hand Raised')).toBeInTheDocument();
    expect(screen.getByText('BR')).toBeInTheDocument();
  });

  it('shows the initial at once for a camera that was never published', () => {
    liveKitMockState.gridMaxTiles = 3;
    const neverPublished = { ...createTrack('camera', 'cam-2', 'bob', { isLocal: false, name: 'Bob Reyes' }), publication: undefined } as unknown as MockTrackRef;
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), neverPublished, createTrack('camera', 'cam-3', 'cleo', { isLocal: false, name: 'Cleo Park' })];
    render(<LiveKitVideoArea {...baseProps()} />);
    expect(screen.getByText('BR').closest('.mtile__cam')).toHaveClass('is-off');
    expect(screen.getByText('CP').closest('.mtile__cam')).not.toHaveClass('is-off');
  });

  it('holds the whiteboard beside a strip that counts who does not fit', () => {
    liveKitMockState.tracks = ['alice', 'bob', 'cara', 'dave', 'erin', 'finn', 'gail'].map((name, index) => createTrack('camera', `cam-${index}`, name, { isLocal: name === 'alice' }));
    render(<LiveKitVideoArea {...baseProps()} isWhiteboardOpen />);
    expect(screen.getAllByTestId('participant-tile')).toHaveLength(4);
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.queryByTestId('local-pip')).not.toBeInTheDocument();
  });

  it('drops the strip beside the whiteboard on a phone', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false })];
    render(<LiveKitVideoArea {...baseProps()} isWhiteboardOpen isMobile />);
    expect(screen.queryByTestId('participant-tile')).not.toBeInTheDocument();
  });

  it('folds to one row of tiles under a sheet on a phone', () => {
    liveKitMockState.tracks = ['alice', 'bob', 'cara', 'dave', 'erin', 'finn', 'gail'].map((name, index) => createTrack('camera', `cam-${index}`, name, { isLocal: name === 'alice' }));
    render(<LiveKitVideoArea {...baseProps()} isMobile compact />);
    expect(screen.getAllByTestId('participant-tile')).toHaveLength(2);
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.queryByTestId('grid-layout')).not.toBeInTheDocument();
  });

  it('keeps carousel orientation in speaker mode', () => {
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false }), createTrack('screen_share', 'share-1', 'alice')];
    render(<LiveKitVideoArea {...baseProps()} layout="speaker" isMobile={false} />);
    expect(screen.getByTestId('carousel-layout')).toHaveAttribute('data-orientation', 'vertical');
    expect(screen.getByTestId('carousel-layout').className).toContain('lk-carousel');
  });

  it('moves the strip beside the large tile on a phone held sideways', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('landscape'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList);
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false }), createTrack('screen_share', 'share-1', 'bob', { isLocal: false })];
    render(<LiveKitVideoArea {...baseProps()} layout="speaker" isMobile />);
    expect(screen.getByTestId('carousel-layout')).toHaveAttribute('data-orientation', 'vertical');

    cleanup();
    matchMedia.mockImplementation((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList);
    render(<LiveKitVideoArea {...baseProps()} layout="speaker" isMobile />);
    expect(screen.getByTestId('carousel-layout')).toHaveAttribute('data-orientation', 'horizontal');
  });

  it('remounts pagination when a placeholder becomes a published track', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const screenShare = createTrack('screen_share', 'share-1', 'alice');
    const remotePlaceholder: MockTrackRef = {
      participant: { identity: 'bob', name: 'Bob', isLocal: false, isSpeaking: false },
      source: 'camera',
    };
    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), remotePlaceholder, screenShare];
    liveKitMockState.pinState = [screenShare];
    const props = baseProps();
    const { rerender } = render(<LiveKitVideoArea {...props} />);
    const initialMountId = screen.getByTestId('carousel-layout').getAttribute('data-mount-id');

    liveKitMockState.tracks = [createTrack('camera', 'cam-1', 'alice'), createTrack('camera', 'cam-2', 'bob', { isLocal: false }), screenShare];
    rerender(<LiveKitVideoArea {...props} />);

    expect(screen.getByTestId('carousel-layout')).not.toHaveAttribute('data-mount-id', initialMountId);
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('updatePages'));
    consoleError.mockRestore();
  });
});
