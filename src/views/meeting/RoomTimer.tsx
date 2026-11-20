import React, { useContext, useEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation } from 'convex/react';
import { Timer } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { IconButton, Tag } from '../../components/ui';
import { withoutError } from '../../hooks/useQueryResult';
import { useMeetingQuery } from './useMeetingQuery';
import { MeetingRoomContext } from './MeetingRoomContext';

const clock = (ms: number) => {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

/** A soft tone when the time is up: one low bell, quiet, no repeat. */
const chime = () => {
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = 'sine';
    tone.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 1.2);
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 1.25);
    tone.onended = () => void audio.close();
  } catch { /* no sound in this browser; the clock still says the time is up */ }
};

/** The room's timer in the top bar: everyone sees it; those who moderate start, pause and stop it. */
export const RoomTimer: React.FC = () => {
  const room = useContext(MeetingRoomContext);
  const scope = room ? { roomId: room.roomId as Id<'rooms'>, accessToken: room.accessToken } : 'skip';
  const timer = withoutError(useMeetingQuery(api.timer.get, scope));
  const canManage = withoutError(useMeetingQuery(api.rooms.canManage, scope)) === true;
  const control = useMutation(api.timer.control);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = !!timer && 'endsAt' in timer && timer.endsAt !== undefined;
  const left = !timer ? 0 : running ? (timer as { endsAt: number }).endsAt - now : (timer as { leftMs: number }).leftMs;

  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [running]);

  // The menu closes on Escape and on a click anywhere else.
  const menuRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown); };
  }, [open]);

  // The tone sounds once, on the screens that saw the time run out.
  const leftRef = useRef(left);
  useEffect(() => {
    if (running && leftRef.current > 0 && left <= 0) chime();
    leftRef.current = left;
  }, [left, running]);

  if (!room || (!timer && !canManage)) return null;
  const act = (action: 'start' | 'add' | 'pause' | 'resume' | 'stop', minutes?: number) => {
    setOpen(false);
    void control({ roomId: room.roomId as Id<'rooms'>, accessToken: room.accessToken, action, minutes });
  };

  return (
    <span className="mtimer">
      {timer && (
        <Tag variant="board" className="shrink-0">
          <span role="timer" aria-label={t`Timer`} className="mtimer__clock">
            {!running && <Trans>Paused</Trans>} {left <= 0 && running ? <Trans>Time is up</Trans> : <span className="fig">{clock(left)}</span>}
          </span>
        </Tag>
      )}
      {canManage && (
        <span className="mtimer__menu" ref={menuRef}>
          <IconButton onBoard label={t`Timer`} onClick={() => setOpen(o => !o)} isOn={open} aria-expanded={open} aria-haspopup="menu">
            <Timer className="icon" aria-hidden="true" />
          </IconButton>
          {open && (
            <span className="menu mtimer__list stock stock--lift" role="menu">
              {[3, 5, 10].map(minutes => (
                <button key={minutes} type="button" role="menuitem" className="menu__item" onClick={() => act('start', minutes)}>
                  <span className="fig">{minutes}</span>&nbsp;<Trans>min</Trans>
                </button>
              ))}
              {timer && <>
                <button type="button" role="menuitem" className="menu__item" onClick={() => act('add')}>+1&nbsp;<Trans>min</Trans></button>
                <button type="button" role="menuitem" className="menu__item" onClick={() => act(running ? 'pause' : 'resume')}>
                  {running ? <Trans>Pause</Trans> : <Trans>Resume</Trans>}
                </button>
                <button type="button" role="menuitem" className="menu__item" onClick={() => act('stop')}><Trans>Stop timer</Trans></button>
              </>}
            </span>
          )}
        </span>
      )}
    </span>
  );
};
