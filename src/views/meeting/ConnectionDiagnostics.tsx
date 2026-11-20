import { useEffect } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { ConnectionQuality, DisconnectReason, type Participant, RoomEvent, Track } from 'livekit-client';

const PREFIX = '[tavio:connection]';
const log = (event: string, detail?: Record<string, unknown>) => console.info(PREFIX, event, detail ?? '');

/**
 * Writes connection events to the console, so a bad call can be told apart afterwards: a weak network
 * (bandwidth), a busy machine (cpu, e.g. the background effect) or a reconnect. Renders nothing.
 * Must live inside <LiveKitRoom>.
 */
export const ConnectionDiagnostics: React.FC = () => {
  const room = useRoomContext();

  useEffect(() => {
    // What holds back our own video, and the round trip and estimated upload of the path in use.
    const sampleSenders = async () => {
      for (const publication of room.localParticipant.trackPublications.values()) {
        const sender = publication.track?.sender;
        if (!sender || publication.kind !== Track.Kind.Video) continue;
        const report = await sender.getStats();
        const layers: Record<string, unknown>[] = [];
        let path: Record<string, unknown> | undefined;
        report.forEach((stat) => {
          if (stat.type === 'outbound-rtp') {
            layers.push({ rid: stat.rid, limitation: stat.qualityLimitationReason, height: stat.frameHeight, fps: stat.framesPerSecond });
          } else if (stat.type === 'candidate-pair' && stat.nominated && stat.state === 'succeeded') {
            path = { rttMs: Math.round((stat.currentRoundTripTime ?? 0) * 1000), uploadKbps: Math.round((stat.availableOutgoingBitrate ?? 0) / 1000) };
          }
        });
        log('sender', { source: publication.source, layers, path });
      }
    };

    const onQuality = (quality: ConnectionQuality, participant: Participant) => {
      if (!participant.isLocal) return;
      log('quality', { quality });
      if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) {
        sampleSenders().catch(() => undefined);
      }
    };
    const onSignalReconnecting = () => log('signal reconnecting');
    const onReconnecting = () => log('media reconnecting');
    const onReconnected = () => log('reconnected');
    const onDisconnected = (reason?: DisconnectReason) =>
      log('disconnected', { reason: reason === undefined ? undefined : DisconnectReason[reason] ?? reason });

    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    room.on(RoomEvent.SignalReconnecting, onSignalReconnecting);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
      room.off(RoomEvent.SignalReconnecting, onSignalReconnecting);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  return null;
};
