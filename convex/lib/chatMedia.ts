// Rules for what the meeting chat accepts besides text. Pure, so the client uses them too.

export const CHAT_UPLOAD_MAX_BYTES = {
  guest: 2 * 1024 * 1024,
  member: 8 * 1024 * 1024,
} as const;

export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ChatImageType = (typeof CHAT_IMAGE_TYPES)[number];

// Unsent uploads older than this are deleted.
export const CHAT_ORPHAN_UPLOAD_MS = 60 * 60 * 1000;

// KLIPY's media hosts, from its network requirements.
export const GIF_HOSTS = ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The image type from the file's first bytes. SVG and anything else is refused, whatever it claims to be. */
export const sniffImageType = (bytes: Uint8Array): ChatImageType | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
};

export const isAllowedGifUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && GIF_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
};

const EMOJI_PART = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️)+$/u;
const EMOJI_CORE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** One emoji, with skin tones, flags and joined sequences. */
export const isReactionEmoji = (value: string) =>
  value.length > 0 && value.length <= 16 && EMOJI_PART.test(value) && EMOJI_CORE.test(value);
