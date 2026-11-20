import { useMemo } from 'react';
import { useRemoteParticipants } from '@livekit/components-react';
import { ParticipantKind, type Participant } from 'livekit-client';

/** The meeting assistant joins as a LiveKit agent. It is no person: no tile, no place in lists, breakouts or the record. */
export const isAssistant = (participant: Pick<Participant, 'kind'> | undefined | null) =>
  participant?.kind === ParticipantKind.AGENT;

/** Remote participants who are people. */
export const usePeople = () => {
  const remote = useRemoteParticipants();
  return useMemo(() => remote.filter(p => !isAssistant(p)), [remote]);
};

/** What the assistant is doing, as its agent framework reports it in the participant attributes. */
/** `heard`: it caught its name in a sentence that is still being said. */
export type AssistantState = 'listening' | 'heard' | 'thinking';

export const useAssistant = (): { present: boolean; state: AssistantState } => {
  const assistant = useRemoteParticipants().find(isAssistant);
  const reported = assistant?.attributes?.['lk.agent.state'];
  return {
    present: !!assistant,
    state: reported === 'thinking' || reported === 'heard' ? reported : 'listening',
  };
};
