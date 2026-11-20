
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Video, VideoOff, ArrowLeft, X, WandSparkles, Sparkles, Ban, Eye, EyeOff } from 'lucide-react';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { Button, IconButton, Input, Avatar, Modal, Select, Switch } from '../components/ui';
import { BrandMark } from '../components/BrandMark';
import { AppView, User, UserRole, Room } from '../types';
import { LocalVideoTrack } from 'livekit-client';
import {
  BackgroundProcessor,
} from '@livekit/track-processors';
import {
  BACKGROUND_PROCESSOR_ASSETS,
  toBackgroundProcessorOptions,
} from './meeting/backgroundProcessorOptions';
import { hasBackgroundProcessorSupport } from './meeting/backgroundProcessorSupport';
import {
  buildAudioCaptureOptions,
  getNoiseReductionSupport,
  readNoiseReductionPreference,
  writeNoiseReductionPreference,
} from './meeting/audioCapture';

type LobbyJoinPayload = Partial<User> & {
  noiseReductionEnabled?: boolean;
  virtualBackground?: string;
  audioInputDeviceId?: string;
  videoInputDeviceId?: string;
  audioOutputDeviceId?: string;
};

interface LobbyProps {
  roomSlug: string;
  initialName?: string;
  lockName?: boolean;
  room?: Room;
  roomLoading?: boolean;
  onNavigate: (view: AppView) => void;
  onJoin: (user: LobbyJoinPayload) => void;
  isJoining?: boolean;
  joinError?: string | null;
  requirePassword?: boolean;
  onPasswordSubmit?: (user: LobbyJoinPayload, password: string) => Promise<boolean | undefined>;
}

interface MediaDevicesState {
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
}

// #COMPLETION_DRIVE: Filter and background preset names are defined at module level and cannot directly use useLingui hook. String translation happens in component render.
// #SUGGEST_VERIFY: Ensure Lingui macro correctly translates preset names by testing locale switching in settings.

const BACKGROUND_PRESET_KEYS = [
  { key: 'bg_none', value: 'none', type: 'none' },
  { key: 'bg_blur', value: 'blur', type: 'blur' },
  { key: 'bg_office', value: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=600&q=80', type: 'image' },
  { key: 'bg_living_room', value: 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=600&q=80', type: 'image' },
  { key: 'bg_abstract', value: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=600&q=80', type: 'image' },
  { key: 'bg_nature', value: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?auto=format&fit=crop&w=600&q=80', type: 'image' },
];

type LobbyBackgroundProcessor = ReturnType<typeof BackgroundProcessor>;

// The room form prefilled this emerald, so stored rooms carry it without anyone having chosen it. It reads as no colour.
const UNCHOSEN_ROOM_COLOR = '#10b981';

const readRoomPrimary = (color?: string): string | null => {
  const value = color?.trim();
  if (!value || !/^#[0-9a-f]{6}$/i.test(value) || value.toLowerCase() === UNCHOSEN_ROOM_COLOR) return null;
  return value;
};

// The room picks the fill; the type takes whichever board tone reads better on it. Both stay put in light and dark.
const roomPrimaryType = (hex: string): string => {
  const [r, g, b] = [1, 3, 5].map(start => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.2 ? 'var(--color-board)' : 'var(--color-board-type)';
};

// Bars of the mic meter: drawn height in px and the audio level above which each one lights.
const METER_BARS = [
  { height: 5, from: 5 },
  { height: 8, from: 10 },
  { height: 11, from: 20 },
  { height: 14, from: 35 },
  { height: 16, from: 55 },
];

// A switched-off control sits pressed into the sheet, like a selection in a groove.
const PRESSED_IN: React.CSSProperties = { boxShadow: 'var(--press-groove)' };

// The gutter steps down with the viewport here: system.css says the same, but its layered :root rule loses to tokens.css.
const LOBBY_GROUND = 'th g-desk';

// Dialogs on the desk keep the work-screen size of their frames instead of the desk's 48px.
const DIALOG_ACTION = 'min-h-[var(--control-work)] px-[var(--space-md)] text-sm';

export const Lobby: React.FC<LobbyProps> = ({ roomSlug, initialName, lockName = false, room, roomLoading, onNavigate, onJoin, isJoining, joinError, requirePassword, onPasswordSubmit }) => {
  const { i18n } = useLingui();

  const [name, setName] = useState(initialName ?? '');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [permissionState, setPermissionState] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [errorMsg, setErrorMsg] = useState('');

  // Helper function to get translated preset names
  const getPresetName = (key: string): string => {
    const presetNameMap: Record<string, string> = {
      'bg_none': i18n._({ id: 'bg_none', message: 'None' }),
      'bg_blur': i18n._({ id: 'bg_blur', message: 'Blur' }),
      'bg_office': i18n._({ id: 'bg_office', message: 'Office' }),
      'bg_living_room': i18n._({ id: 'bg_living_room', message: 'Living Room' }),
      'bg_abstract': i18n._({ id: 'bg_abstract', message: 'Abstract' }),
      'bg_nature': i18n._({ id: 'bg_nature', message: 'Nature' }),
    };
    return presetNameMap[key] || key;
  };

  // Branding is bounded: a logo, a colour on the join action, a photo that replaces the desk, and a dark view if the room asks.
  const roomPrimary = readRoomPrimary(room?.branding?.primaryColor);
  const logoUrl = room?.branding?.logoUrl;
  const bgImage = room?.branding?.backgroundImageUrl;
  const isDarkRoom = room?.branding?.theme === 'dark';
  const isBranded = Boolean(roomPrimary || logoUrl || bgImage || isDarkRoom);

  // Device State (preview + LiveKit alignment)
  const [devices, setDevices] = useState<MediaDevicesState>({
    audioInputs: [],
    audioOutputs: [],
    videoInputs: [],
  });
  
  const [selectedDevices, setSelectedDevices] = useState({
    audioInput: '',
    audioOutput: '',
    videoInput: '',
  });

  // Effects & Processing State
  const [virtualBackground, setVirtualBackground] = useState('none');
  const [backgroundEffectError, setBackgroundEffectError] = useState<string | null>(null);
  const [backgroundDebugInfo, setBackgroundDebugInfo] = useState({
    scriptLoaded: false,
    engineInitialized: false,
    framesProcessed: 0,
    lastError: '',
  });
  const [isNoiseReductionEnabled, setIsNoiseReductionEnabled] = useState(() => readNoiseReductionPreference(true));
  const [isNoiseReductionSupported, setIsNoiseReductionSupported] = useState(() => getNoiseReductionSupport().supported);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [pendingJoinPayload, setPendingJoinPayload] = useState<LobbyJoinPayload | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isPasswordSubmitting, setIsPasswordSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (initialName) setName(initialName);
  }, [initialName]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const streamRef = useRef<MediaStream | null>(null);
  const localVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const backgroundProcessorRef = useRef<LobbyBackgroundProcessor | null>(null);
  const backgroundProcessorTrackRef = useRef<LocalVideoTrack | null>(null);
  const backgroundSourceKeyRef = useRef<string | null>(null);
  const backgroundModeRef = useRef<string | null>(null);
  const backgroundOperationRef = useRef<Promise<void>>(Promise.resolve());
  const backgroundRequestVersionRef = useRef(0);
  const backgroundDisposedRef = useRef(false);
  const audioLevelRef = useRef(0);
  const debugFrameCountRef = useRef(0);
  const debugBgEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugBg') === '1';

  // Cleanup function
  const stopStream = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    if (analyserRef.current) {
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    backgroundRequestVersionRef.current += 1;
    const trackToClean = localVideoTrackRef.current;
    if (trackToClean && videoRef.current) {
      trackToClean.detach(videoRef.current);
    }
    localVideoTrackRef.current = null;
    const processorTrackToClean = backgroundProcessorTrackRef.current;
    const processorCleanup = backgroundOperationRef.current.catch(() => {}).then(async () => {
      const ownedProcessorTrack = processorTrackToClean
        ?? (backgroundProcessorTrackRef.current === trackToClean ? backgroundProcessorTrackRef.current : null);
      if (ownedProcessorTrack) {
        await ownedProcessorTrack.stopProcessor().catch(() => {});
        if (backgroundProcessorTrackRef.current === ownedProcessorTrack) {
          backgroundProcessorRef.current = null;
          backgroundProcessorTrackRef.current = null;
          backgroundSourceKeyRef.current = null;
          backgroundModeRef.current = null;
        }
      }
    });
    backgroundOperationRef.current = processorCleanup;
    void processorCleanup;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setAudioLevel(0);
    audioLevelRef.current = 0;
  }, []);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  // Initialize: Request permissions and get devices (for preview UI labels)
  useEffect(() => {
    const init = async () => {
      try {
        const initialStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        setPermissionState('granted');
        initialStream.getTracks().forEach(t => t.stop());

        const allDevices = await navigator.mediaDevices.enumerateDevices();
        
        const audioInputs = allDevices.filter(d => d.kind === 'audioinput');
        const audioOutputs = allDevices.filter(d => d.kind === 'audiooutput');
        const videoInputs = allDevices.filter(d => d.kind === 'videoinput');

        setDevices({ audioInputs, audioOutputs, videoInputs });

        setSelectedDevices(prev => ({
          audioInput: prev.audioInput || audioInputs[0]?.deviceId || '',
          audioOutput: prev.audioOutput || audioOutputs[0]?.deviceId || '',
          videoInput: prev.videoInput || videoInputs[0]?.deviceId || '',
        }));

      } catch (err: any) {
        console.error("Error accessing media devices:", err);
        setPermissionState('denied');
        setErrorMsg(err.name === 'NotAllowedError'
          ? i18n._({ id: 'msg_permission_denied', message: 'Permission denied' })
          : i18n._({ id: 'msg_device_error', message: 'Device error' })
        );
      }
    };

    init();

    const handleDeviceChange = async () => {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        audioInputs: allDevices.filter(d => d.kind === 'audioinput'),
        audioOutputs: allDevices.filter(d => d.kind === 'audiooutput'),
        videoInputs: allDevices.filter(d => d.kind === 'videoinput'),
      });
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      stopStream();
    };
  }, []);

  // Effect: Start Stream when devices selected or mute/cam toggled
  useEffect(() => {
    setIsNoiseReductionSupported(getNoiseReductionSupport().supported);
  }, []);

  useEffect(() => {
    writeNoiseReductionPreference(isNoiseReductionEnabled);
  }, [isNoiseReductionEnabled]);

  useEffect(() => {
    if (permissionState !== 'granted') return;
    if (!selectedDevices.audioInput && !selectedDevices.videoInput) return;

    const startStream = async () => {
      // Don't fully stop stream if just changing effects, but here we rebuild for device changes
      stopStream();

      const constraints: MediaStreamConstraints = {
        audio: selectedDevices.audioInput
          ? (buildAudioCaptureOptions({
              deviceId: selectedDevices.audioInput,
              noiseReductionEnabled: isNoiseReductionEnabled,
            }) as MediaTrackConstraints)
          : false,
        video: selectedDevices.videoInput ? { 
          deviceId: { exact: selectedDevices.videoInput },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : false,
      };

      try {
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          newStream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = newStream;
        const videoTrack = newStream.getVideoTracks()[0];
        const localVideoTrack = videoTrack ? new LocalVideoTrack(videoTrack, undefined, true) : null;
        localVideoTrackRef.current = localVideoTrack;
        if (localVideoTrack && videoRef.current) {
          localVideoTrack.attach(videoRef.current);
        }
        setStream(newStream);

        if (newStream.getAudioTracks().length > 0) {
          try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioContextRef.current = audioContext;

            // Resume audio context - required by modern browsers due to autoplay policies
            await audioContext.resume();

            const analyser = audioContext.createAnalyser();
            analyserRef.current = analyser;
            analyser.fftSize = 256; // Smaller for faster response
            analyser.smoothingTimeConstant = 0.3; // Less smoothing for snappier response

            const source = audioContext.createMediaStreamSource(newStream);
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const analyze = () => {
              const currentAnalyser = analyserRef.current;
              const currentContext = audioContextRef.current;

              if (!currentAnalyser || !currentContext || currentContext.state !== 'running') {
                animationFrameRef.current = requestAnimationFrame(analyze);
                return;
              }

              // Use frequency data for more visible response
              currentAnalyser.getByteFrequencyData(dataArray);

              // Calculate average of frequency bins (more responsive than RMS)
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const average = sum / dataArray.length;

              // Scale to 0-100 range (frequency data is 0-255)
              const targetLevel = Math.min(100, (average / 255) * 150);

              // Fast attack, slower decay for snappy feel
              if (targetLevel > audioLevelRef.current) {
                audioLevelRef.current = targetLevel; // Instant attack
              } else {
                audioLevelRef.current += (targetLevel - audioLevelRef.current) * 0.15; // Smooth decay
              }

              setAudioLevel(audioLevelRef.current);
              animationFrameRef.current = requestAnimationFrame(analyze);
            };

            analyze();
          } catch {
            // Audio analysis setup failed - meter won't work but app continues
          }
        }
      } catch (err) {
        console.error("Failed to start stream with selected devices", err);
      }
    };

    let cancelled = false;
    startStream();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [selectedDevices.audioInput, selectedDevices.videoInput, permissionState, isNoiseReductionEnabled, stopStream]);

  // LiveKit's processor owns all segmentation, blur, and virtual-background
  // rendering. Initialize it only when an effect is selected, then use
  // switchTo for effect changes so rapid selections remain ordered.
  const applyBackgroundProcessor = useCallback(() => {
    const requestVersion = ++backgroundRequestVersionRef.current;
    const requestedMode = virtualBackground;
    const requestedTrack = localVideoTrackRef.current;
    const requestedSourceSettings = requestedTrack?.getSourceTrackSettings();
    const requestedSourceKey = requestedTrack
      ? `${requestedSourceSettings?.deviceId ?? requestedTrack.mediaStreamTrack.id}:${requestedSourceSettings?.width ?? ''}x${requestedSourceSettings?.height ?? ''}`
      : null;
    const operation = async () => {
      if (backgroundDisposedRef.current || requestVersion !== backgroundRequestVersionRef.current) return;

      setBackgroundEffectError(null);
      setBackgroundDebugInfo(prev => ({
        ...prev,
        scriptLoaded: hasBackgroundProcessorSupport(),
        engineInitialized: !!backgroundProcessorRef.current,
        lastError: '',
      }));

      if (!requestedTrack) {
        if (backgroundProcessorTrackRef.current) {
          await backgroundProcessorTrackRef.current.stopProcessor().catch(() => {});
          backgroundProcessorRef.current = null;
          backgroundProcessorTrackRef.current = null;
          backgroundSourceKeyRef.current = null;
          backgroundModeRef.current = null;
        }
        if (requestVersion === backgroundRequestVersionRef.current) {
          setBackgroundDebugInfo(prev => ({ ...prev, engineInitialized: false }));
        }
        return;
      }

      if (requestedMode === 'none') {
        if (backgroundProcessorTrackRef.current) {
          await backgroundProcessorTrackRef.current.stopProcessor().catch(() => {});
          backgroundProcessorRef.current = null;
          backgroundProcessorTrackRef.current = null;
          backgroundSourceKeyRef.current = null;
          backgroundModeRef.current = null;
        }
        if (requestVersion === backgroundRequestVersionRef.current) {
          setBackgroundDebugInfo(prev => ({ ...prev, engineInitialized: false }));
        }
        return;
      }

      const supported = hasBackgroundProcessorSupport();
      if (!supported) {
        throw new Error(i18n._({
          id: 'bg_effect_engine_missing',
          message: 'Background engine could not be loaded. Try refreshing the page.',
        }));
      }

      const sameSource = backgroundProcessorRef.current
        && backgroundProcessorTrackRef.current === requestedTrack
        && localVideoTrackRef.current === requestedTrack
        && backgroundSourceKeyRef.current === requestedSourceKey;
      if (!sameSource) {
        if (backgroundProcessorTrackRef.current) {
          await backgroundProcessorTrackRef.current.stopProcessor().catch(() => {});
          backgroundProcessorRef.current = null;
          backgroundProcessorTrackRef.current = null;
          backgroundSourceKeyRef.current = null;
          backgroundModeRef.current = null;
        }
        const processor = BackgroundProcessor({
          mode: 'disabled',
          assetPaths: BACKGROUND_PROCESSOR_ASSETS,
          onFrameProcessed: () => {
            const framesProcessed = ++debugFrameCountRef.current;
            if (framesProcessed % 30 === 0) {
              setBackgroundDebugInfo(prev => ({ ...prev, framesProcessed }));
            }
          },
        });
        await requestedTrack.setProcessor(processor);
        if (backgroundDisposedRef.current || requestVersion !== backgroundRequestVersionRef.current) {
          await requestedTrack.stopProcessor().catch(() => {});
          return;
        }
        backgroundProcessorRef.current = processor;
        backgroundProcessorTrackRef.current = requestedTrack;
        backgroundSourceKeyRef.current = requestedSourceKey;
        backgroundModeRef.current = 'none';
      }

      if (requestVersion !== backgroundRequestVersionRef.current) return;
      if (backgroundProcessorRef.current && backgroundModeRef.current !== requestedMode) {
        await backgroundProcessorRef.current.switchTo(toBackgroundProcessorOptions(requestedMode));
        backgroundModeRef.current = requestedMode;
      }
      if (requestVersion === backgroundRequestVersionRef.current) {
        setBackgroundDebugInfo(prev => ({ ...prev, engineInitialized: true }));
      }
    };

    backgroundOperationRef.current = backgroundOperationRef.current.catch(() => {}).then(operation);
    void backgroundOperationRef.current.catch((error) => {
      if (requestVersion !== backgroundRequestVersionRef.current) return;
      const message = error instanceof Error
        ? error.message
        : i18n._({ id: 'bg_effect_init_failed', message: 'Unable to start background effects.' });
      setBackgroundEffectError(message);
      setBackgroundDebugInfo(prev => ({ ...prev, lastError: message }));
    });
  }, [i18n, virtualBackground]);

  useEffect(() => {
    backgroundDisposedRef.current = false;
    return () => {
      backgroundDisposedRef.current = true;
      backgroundRequestVersionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    applyBackgroundProcessor();
  }, [applyBackgroundProcessor, stream]);

  // Apply Mute/Cam Off logic to live stream
  useEffect(() => {
    if (stream) {
      stream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
      stream.getVideoTracks().forEach(track => { track.enabled = !isCameraOff; });
    }
  }, [isMuted, isCameraOff, stream]);

  const handleJoin = () => {
    if (roomLoading || !room) {
      return;
    }

    if (!name.trim()) {
      setErrorMsg(i18n._({ id: 'msg_enter_name', message: 'Please enter your name to join' }));
      return;
    }

    const payload: LobbyJoinPayload = {
      name: name.trim(),
      isMuted,
      isCameraOff,
      noiseReductionEnabled: isNoiseReductionEnabled,
      role: UserRole.PARTICIPANT,
      virtualBackground,
      audioInputDeviceId: selectedDevices.audioInput || undefined,
      videoInputDeviceId: selectedDevices.videoInput || undefined,
      audioOutputDeviceId: selectedDevices.audioOutput || undefined,
    };
    if (requirePassword) {
      setPendingJoinPayload(payload);
      setPasswordModalOpen(true);
      return;
    }
    onJoin(payload);
  };

  const selectDevice = (kind: keyof typeof selectedDevices) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { value } = e.target;
    setSelectedDevices(p => ({ ...p, [kind]: value }));
  };

  const closePasswordModal = () => {
    setPasswordModalOpen(false);
    setPasswordError(null);
    setPendingJoinPayload(null);
    setShowPassword(false);
  };

  const submitPassword = async () => {
    if (isPasswordSubmitting) return;
    const pwd = passwordRef.current?.value.trim() ?? '';
    if (!pwd) {
      setPasswordError(i18n._({ id: 'msg_password_required', message: 'Password required' }));
      return;
    }
    if (!pendingJoinPayload) {
      handleJoin();
      return;
    }
    setIsPasswordSubmitting(true);
    try {
      const success = await onPasswordSubmit?.(pendingJoinPayload, pwd);
      if (success) {
        setPasswordModalOpen(false);
        setPendingJoinPayload(null);
        setPasswordError(null);
      }
    } catch {
      // joinError prop will surface the error; modal stays open
    } finally {
      setIsPasswordSubmitting(false);
    }
  };

  // A room's photo can be any colour, so what sits directly on it needs its own piece of stock to stay readable.
  // The preview only mounts once the room has loaded, which can be after the camera track was attached.
  useEffect(() => {
    const track = localVideoTrackRef.current;
    if (track && videoRef.current && !videoRef.current.srcObject) {
      track.attach(videoRef.current);
    }
  }, [roomLoading, room]);

  const homeButton = (
    <button
      type="button"
      onClick={() => onNavigate(AppView.LANDING)}
      aria-label={i18n._(/* i18n */ 'Tavio home')}
      className={`flex min-h-11 items-center text-ink ${bgImage ? 'stock px-3' : 'rounded-input'}`}
    >
      {logoUrl ? (
        <img src={logoUrl} alt={i18n._({ id: 'Room logo', message: 'Room logo' })} className="h-8 max-w-[50vw] object-contain" />
      ) : (
        <BrandMark logoClassName="bar__logo" />
      )}
    </button>
  );

  if (roomLoading) {
    return (
      <main className={LOBBY_GROUND}>
        <div className="th__top">{homeButton}</div>
        <div className="grid place-items-center px-[var(--gutter)] pb-[72px]">
          <div role="status" className="authsheet stock stock--lift">
            <span className="spin size-[22px] text-muted" aria-hidden="true" />
            <div>
              <h1 className="th__h">
                <Trans>Loading room...</Trans>
              </h1>
              <p className="muted mt-1.5 text-md [overflow-wrap:anywhere]">
                <Trans>Preparing your lobby for /{roomSlug}</Trans>
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // UX: Show error page if room doesn't exist
  if (!room) {
    return (
      <main className={LOBBY_GROUND}>
        <div className="th__top">{homeButton}</div>
        <div className="grid place-items-center px-[var(--gutter)] pb-[72px]">
          <div className="authsheet stock stock--lift">
            <div>
              <h1 className="th__h">
                <Trans>Room Not Found</Trans>
              </h1>
              <p className="muted mt-1.5 text-md [overflow-wrap:anywhere]">
                <Trans>The room /{roomSlug} does not exist or has been deleted.</Trans>
              </p>
            </div>
            <Button size="lg" className="btn--wide" onClick={() => onNavigate(AppView.LANDING)}>
              <Trans>Go to Home</Trans>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const devicesGranted = permissionState === 'granted';
  const defaultMic = i18n._({ id: 'default_mic', message: 'Default Microphone' });
  const defaultCamera = i18n._({ id: 'default_device', message: 'Default Device' });
  const roomNameDiffers = room.name.trim().toLowerCase() !== roomSlug.toLowerCase();
  const hasParticipants = room.activeParticipants != null && room.activeParticipants > 0;

  return (
    <main className={`${LOBBY_GROUND} ${isDarkRoom ? 'dark' : ''}`} style={bgImage ? { backgroundImage: `url("${bgImage}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>

      {/* Speaker, noise reduction and backgrounds: everything the join sheet does not carry itself */}
      {showSettings && (
        <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} ariaLabel={i18n._({ id: 'effects_tooltip', message: 'Effects' })} className="max-h-[90dvh] overflow-y-auto">
          <div className="grid gap-4 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="dialog__title">
                <Trans>Effects</Trans>
              </h2>
              <IconButton label={i18n._({ id: 'close_meeting_settings', message: 'Close meeting settings' })} onClick={() => setShowSettings(false)}>
                <X className="icon" aria-hidden="true" />
              </IconButton>
            </div>

            <div className="grid gap-2">
              <p className="field__label">
                <Trans>Virtual Backgrounds</Trans>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {BACKGROUND_PRESET_KEYS.map(bg => (
                  <button
                    key={bg.key}
                    type="button"
                    onClick={() => setVirtualBackground(bg.value)}
                    aria-label={getPresetName(bg.key)}
                    aria-pressed={virtualBackground === bg.value}
                    className={`bgopt ${virtualBackground === bg.value ? 'is-on' : ''}`}
                  >
                    <span className="bgopt__pic">
                      {bg.type === 'image' && <img src={bg.value} alt="" />}
                      {bg.type === 'blur' && <Sparkles className="icon" aria-hidden="true" />}
                      {bg.type === 'none' && <Ban className="icon" aria-hidden="true" />}
                    </span>
                    <span>{getPresetName(bg.key)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="field__label">
                  <Trans>Noise Reduction</Trans>
                </p>
                <p className="field__help">
                  <Trans>Filters background noise for clearer audio.</Trans>
                </p>
                {!isNoiseReductionSupported && (
                  <p className="field__help">
                    <Trans>Your browser does not expose noise suppression controls.</Trans>
                  </p>
                )}
              </div>
              <Switch
                checked={isNoiseReductionEnabled}
                onChange={setIsNoiseReductionEnabled}
                disabled={!isNoiseReductionSupported}
                label={i18n._({ id: 'lobby_noise_reduction_toggle', message: 'Toggle noise reduction' })}
              />
            </div>

            {devices.audioOutputs.length > 0 && (
              <Select
                label={i18n._({ id: 'lobby_speaker_label', message: 'Speaker' })}
                value={selectedDevices.audioOutput}
                onChange={selectDevice('audioOutput')}
                className="truncate"
              >
                {devices.audioOutputs.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || i18n._({ id: 'lobby_speaker_label', message: 'Speaker' })}
                  </option>
                ))}
              </Select>
            )}

            <div className="dialog__actions">
              <Button onClick={() => setShowSettings(false)} className={DIALOG_ACTION}>
                <Trans>Done</Trans>
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <div className="th__top">
        {homeButton}
        <Button
          type="button"
          variant={bgImage ? 'outline' : 'ghost'}
          size="sm"
          onClick={() => onNavigate(AppView.LANDING)}
          className={bgImage ? '' : '-mr-3 gap-1.5 font-normal text-ink-2'}
        >
          <ArrowLeft className="icon" aria-hidden="true" />
          <Trans>Back</Trans>
        </Button>
      </div>

      <div className="lobbygrid">
        {/* The preview: a print lying on the desk, with its controls on the margin and not on the picture */}
        <div className="relative w-full min-w-0 max-[60rem]:max-w-[40rem] max-[60rem]:justify-self-center">
          <figure className="prev stock stock--lift">
            <div className={`prev__view ${permissionState === 'denied' ? 'max-[40rem]:aspect-auto max-[40rem]:min-h-60' : 'max-[40rem]:aspect-video'}`}>
              {/* Video Layers */}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={`absolute inset-0 w-full h-full object-cover ${isCameraOff ? 'opacity-0' : ''}`}
                style={{ transform: 'scaleX(-1)' }}
              />

              {/* Fallback Avatar / Permission State */}
              {(isCameraOff || !devicesGranted) && (
                <div className="g-board absolute inset-0 grid place-items-center p-4 text-center sm:p-6">
                  {devicesGranted ? (
                    <Avatar name={name || "You"} size="xl" className="bg-board-3 text-board-type" />
                  ) : permissionState === 'denied' ? (
                    <div className="grid justify-items-center gap-2">
                      <VideoOff className="icon icon--l" aria-hidden="true" />
                      <h2 className="text-md font-semibold"><Trans>Access Denied</Trans></h2>
                      <p className="max-w-xs text-sm text-board-muted"><Trans>Please allow camera and microphone access to join the meeting.</Trans></p>
                      <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()} className="mt-1"><Trans>Try Again</Trans></Button>
                    </div>
                  ) : (
                    <div role="status" className="grid justify-items-center gap-3 text-board-muted">
                      <span className="spin size-[22px]" aria-hidden="true" />
                      <p className="text-sm"><Trans>Initializing devices...</Trans></p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="prev__foot">
              {/* Quick Controls */}
              <div className="flex flex-none gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => setIsMuted(!isMuted)}
                  disabled={!devicesGranted}
                  aria-label={isMuted ? i18n._({ id: 'unmute_microphone', message: 'Unmute microphone' }) : i18n._({ id: 'mute_microphone', message: 'Mute microphone' })}
                  aria-pressed={isMuted}
                  className={isMuted ? 'bg-paper-3' : ''}
                  style={isMuted ? PRESSED_IN : undefined}
                >
                  {isMuted ? <MicOff className="icon" aria-hidden="true" /> : <Mic className="icon" aria-hidden="true" />}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => setIsCameraOff(!isCameraOff)}
                  disabled={!devicesGranted}
                  aria-label={isCameraOff ? i18n._({ id: 'turn_camera_on', message: 'Turn camera on' }) : i18n._({ id: 'turn_camera_off', message: 'Turn camera off' })}
                  aria-pressed={isCameraOff}
                  className={isCameraOff ? 'bg-paper-3' : ''}
                  style={isCameraOff ? PRESSED_IN : undefined}
                >
                  {isCameraOff ? <VideoOff className="icon" aria-hidden="true" /> : <Video className="icon" aria-hidden="true" />}
                </Button>
                {/* Stays open with the camera off: speaker and noise reduction live behind it too */}
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={() => setShowSettings(true)}
                  disabled={!devicesGranted}
                  title={i18n._({ id: 'effects_tooltip', message: 'Effects' })}
                  aria-label={i18n._({ id: 'effects_tooltip', message: 'Effects' })}
                >
                  <WandSparkles className="icon" aria-hidden="true" />
                </Button>
              </div>

              {/* Audio Meter */}
              {!isMuted && devicesGranted && (
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                  <span className="truncate max-[22rem]:hidden"><Trans>Mic Level</Trans></span>
                  <div className="meter flex-none" aria-hidden="true">
                    {METER_BARS.map(bar => (
                      <i key={bar.height} className={audioLevel > bar.from ? 'on' : ''} style={{ height: bar.height }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </figure>

          {!isBranded && (
            <p className="linktag stock stock--lift absolute right-[-14px] top-[-18px] z-10 hidden max-w-[calc(100%-1.5rem)] rotate-[1.4deg] min-[60rem]:block">
              <span className="linktag__label"><Trans>Room link</Trans></span>
              <span className="linktag__url block truncate">{window.location.host}/room/{roomSlug}</span>
            </p>
          )}
        </div>

        {/* Right: Join Form */}
        <div className="joinsheet stock stock--lift w-full min-w-0 grid-cols-[minmax(0,1fr)] max-[60rem]:max-w-[40rem] max-[60rem]:justify-self-center">
          <div>
            <h1 className="th__h text-3xl">
              <Trans>Ready?</Trans>
            </h1>
            <p className="mt-1 text-md [overflow-wrap:anywhere]">
              <Trans>You're joining</Trans> <span className="fig text-ink">/{roomSlug}</span>
            </p>
            {(roomNameDiffers || hasParticipants) && (
              <p className="muted mt-0.5 text-sm [overflow-wrap:anywhere]">
                {roomNameDiffers && room.name}
                {roomNameDiffers && hasParticipants && ' · '}
                {hasParticipants && (room.activeParticipants === 1
                  ? <Trans>1 participant already in the room</Trans>
                  : <Trans>{room.activeParticipants} participants already in the room</Trans>
                )}
              </p>
            )}
          </div>

          <Input
            label={i18n._({ id: 'lobby_display_name_label', message: 'Display Name' })}
            placeholder={i18n._({ id: 'lobby_display_name_placeholder', message: 'Enter your name' })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={lockName}
            disabled={lockName}
            autoFocus
          />
          {lockName && <p className="field__help -mt-3"><Trans>Your transferred meeting identity is fixed for this handoff.</Trans></p>}

          <Select
            label={i18n._({ id: 'lobby_microphone_label', message: 'Microphone' })}
            value={selectedDevices.audioInput}
            onChange={selectDevice('audioInput')}
            disabled={!devicesGranted}
            className="truncate"
          >
            {devices.audioInputs.length === 0 && <option value="">{defaultMic}</option>}
            {devices.audioInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || defaultMic}</option>)}
          </Select>

          <Select
            label={i18n._({ id: 'lobby_camera_label', message: 'Camera' })}
            value={selectedDevices.videoInput}
            onChange={selectDevice('videoInput')}
            disabled={!devicesGranted}
            className="truncate"
          >
            {devices.videoInputs.length === 0 && <option value="">{defaultCamera}</option>}
            {devices.videoInputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || defaultCamera}</option>)}
          </Select>
          {permissionState === 'denied' && <p className="field__help field__help--error -mt-3"><Trans>Check permissions</Trans></p>}

          <button
            type="button"
            className={`btn ${roomPrimary ? 'btn--room' : 'btn--ink'} btn--l btn--wide whitespace-normal ${isJoining ? 'cursor-wait opacity-75' : ''}`}
            style={roomPrimary ? { '--room-primary': roomPrimary, '--room-primary-type': roomPrimaryType(roomPrimary) } as React.CSSProperties : undefined}
            onClick={handleJoin}
            disabled={roomLoading || !room || !name.trim() || !devicesGranted || isJoining}
          >
            {isJoining && <span className="spin" aria-hidden="true" />}
            {isJoining
              ? i18n._({ id: 'msg_joining', message: 'Joining…' })
              : requirePassword
              ? i18n._({ id: 'msg_join_protected', message: 'Join with password' })
              : i18n._({ id: 'msg_join_meeting', message: 'Join Meeting' })
            }
          </button>
          {(joinError || errorMsg) && (
            <p role="alert" className="text-sm text-error">{joinError || errorMsg}</p>
          )}
          {backgroundEffectError && (
            <p role="alert" className="text-sm text-error">{backgroundEffectError}</p>
          )}
          {debugBgEnabled && (
            <div className="grid gap-0.5 rounded-input border border-rule bg-paper-2 p-3 text-xs text-ink-2">
              <p className="font-semibold text-ink">Background Debug</p>
              <p>scriptLoaded: {String(backgroundDebugInfo.scriptLoaded)}</p>
              <p>engineInitialized: {String(backgroundDebugInfo.engineInitialized)}</p>
              <p>framesProcessed: {backgroundDebugInfo.framesProcessed}</p>
              <p className="break-all">lastError: {backgroundDebugInfo.lastError || 'none'}</p>
            </div>
          )}
        </div>
      </div>

      {/* Password Modal */}
      {passwordModalOpen && (
        <Modal isOpen={passwordModalOpen} onClose={closePasswordModal} ariaLabel={i18n._({ id: 'password_modal_title', message: 'Enter Room Password' })}>
          <div className="dialog w-full">
            <h2 className="dialog__title"><Trans>Enter Room Password</Trans></h2>
            {/* Uncontrolled input via ref so password managers can write to the DOM
                freely without React overwriting the value on each re-render. */}
            <form onSubmit={(e) => { e.preventDefault(); void submitPassword(); }} className="field">
              <label htmlFor="lobby-room-password" className="field__label">
                {i18n._({ id: 'Password', message: 'Password' })}
              </label>
              <div className="relative">
                <input
                  id="lobby-room-password"
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  defaultValue=""
                  onChange={() => setPasswordError(null)}
                  aria-invalid={passwordError || joinError ? 'true' : undefined}
                  aria-describedby={passwordError || joinError ? 'lobby-room-password-error' : undefined}
                  className={`input pr-12 ${passwordError || joinError ? 'input--error' : ''}`}
                  placeholder={i18n._({ id: 'placeholder_room_password', message: 'Room password' })}
                />
                <IconButton
                  label={showPassword ? i18n._({ id: 'Hide password', message: 'Hide password' }) : i18n._({ id: 'Show password', message: 'Show password' })}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-1.5 top-1.5"
                >
                  {showPassword ? <EyeOff className="icon" aria-hidden="true" /> : <Eye className="icon" aria-hidden="true" />}
                </IconButton>
              </div>
              {(passwordError || joinError) && <p id="lobby-room-password-error" role="alert" className="field__help field__help--error">{passwordError || joinError}</p>}
            </form>
            <div className="dialog__actions">
              <Button variant="secondary" onClick={closePasswordModal} className={DIALOG_ACTION}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                className={DIALOG_ACTION}
                disabled={isPasswordSubmitting}
                onClick={() => void submitPassword()}
              >
                {isPasswordSubmitting ? <Trans>Joining…</Trans> : <Trans>Join</Trans>}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
};
