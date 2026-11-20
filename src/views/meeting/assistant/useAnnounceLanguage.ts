import { useEffect } from 'react';
import { useConnectionState, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { useLingui } from '@lingui/react';

export const LANGUAGE_ATTRIBUTE = 'lang';

/**
 * Tells the room which language this person's app is in. The meeting assistant listens to each person in their own
 * language, and a German speaker and an English speaker in one call both need to be understood. It is only a hint for
 * speech recognition: the assistant accepts a handful of languages and ignores anything else.
 */
export const useAnnounceLanguage = () => {
  const { localParticipant } = useLocalParticipant();
  const connection = useConnectionState();
  const { i18n } = useLingui();
  const locale = i18n.locale;

  useEffect(() => {
    if (connection !== ConnectionState.Connected || !locale) return;
    if (localParticipant.attributes?.[LANGUAGE_ATTRIBUTE] === locale) return;
    // Attributes are merged, so the role set when the token was issued stays.
    void Promise.resolve(localParticipant.setAttributes({ [LANGUAGE_ATTRIBUTE]: locale })).catch(() => { /* the assistant then listens in its default language */ });
  }, [connection, locale, localParticipant]);
};
