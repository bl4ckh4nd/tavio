import { t } from '@lingui/core/macro';
import { CHAT_IMAGE_TYPES } from '../../../../convex/lib/chatMedia';

const MAX_EDGE = 2048;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  previewUrl: string;
}

export const isChatImageFile = (file: File) => (CHAT_IMAGE_TYPES as readonly string[]).includes(file.type);

/**
 * Shrinks photos to at most 2048 px and re-encodes them, which also drops EXIF data such as the
 * location. GIFs stay as they are so they keep moving.
 */
export const prepareImage = async (file: File): Promise<PreparedImage> => {
  const bitmap = await createImageBitmap(file);
  try {
    if (file.type === 'image/gif') {
      return { blob: file, width: bitmap.width, height: bitmap.height, previewUrl: URL.createObjectURL(file) };
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    let blob = await encode('image/webp', 0.88);
    // Browsers without a WebP encoder hand back PNG, which is far larger; JPEG keeps photos small.
    if (blob && blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.86);
    if (!blob) throw new Error(t`This image could not be read.`);
    return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
};

const postImage = async (roomId: string, accessToken: string | undefined, blob: Blob, forBoard: boolean) => {
  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL;
  const response = await fetch(`${siteUrl}/chat/upload?roomId=${encodeURIComponent(roomId)}${forBoard ? '&for=board' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.uploadId) {
    if (response.status === 413) throw new Error(t`This image is too large to share.`);
    if (response.status === 429) throw new Error(t`Too many images for now. Try again later.`);
    if (response.status === 415) throw new Error(t`Only PNG, JPEG, GIF and WebP images can be shared.`);
    throw new Error(t`The image could not be uploaded.`);
  }
  return body as { uploadId: string; url?: string };
};

/** Sends the image to the room's upload endpoint and returns the id chat.send takes. */
export const uploadChatImage = async (roomId: string, accessToken: string | undefined, blob: Blob): Promise<string> =>
  (await postImage(roomId, accessToken, blob, false)).uploadId;

/** Stores an image pasted onto the room's board, never cleaned up as an unsent chat image, and returns the address everyone loads it from. */
export const uploadBoardImage = async (roomId: string, accessToken: string | undefined, blob: Blob): Promise<string> => {
  const { url } = await postImage(roomId, accessToken, blob, true);
  if (!url) throw new Error(t`The image could not be uploaded.`);
  return url;
};

// --- GIFs from KLIPY ---
// KLIPY's terms want searches and media loads to come straight from the browser, so the key is a
// public build variable. Without it the GIF button stays hidden.

export const KLIPY_API_KEY: string | undefined = import.meta.env.VITE_KLIPY_API_KEY || undefined;

export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  width: number;
  height: number;
}

const KLIPY_LOCALES: Record<string, string> = { de: 'de_DE', en: 'en_US', es: 'es_ES', fr: 'fr_FR' };

// An anonymous per-browser id, which KLIPY asks for to tell users apart.
const klipyCustomerId = () => {
  const make = () => crypto.randomUUID();
  try {
    const stored = localStorage.getItem('tavio:gif-id');
    if (stored) return stored;
    const id = make();
    localStorage.setItem('tavio:gif-id', id);
    return id;
  } catch {
    return make();
  }
};

const pickFile = (file: any, sizes: string[]) => {
  for (const size of sizes) {
    for (const format of ['webp', 'gif']) {
      const entry = file?.[size]?.[format];
      if (entry?.url) return { url: String(entry.url), width: Number(entry.width) || 1, height: Number(entry.height) || 1 };
    }
  }
  return null;
};

export const searchGifs = async ({ q, page, locale, signal }: { q: string; page: number; locale: string; signal?: AbortSignal }) => {
  if (!KLIPY_API_KEY) throw new Error('GIF search is not set up');
  const params = new URLSearchParams({
    page: String(page),
    per_page: '24',
    customer_id: klipyCustomerId(),
    locale: KLIPY_LOCALES[locale] ?? 'en_US',
  });
  const trimmed = q.trim();
  if (trimmed) params.set('q', trimmed);
  const kind = trimmed ? 'search' : 'trending';
  const response = await fetch(`https://api.klipy.com/api/v1/${encodeURIComponent(KLIPY_API_KEY)}/gifs/${kind}?${params}`, { signal });
  if (!response.ok) throw new Error(t`GIF search is unavailable right now.`);
  const body: any = await response.json();
  const items: GifResult[] = [];
  // KLIPY asks that results keep their order and composition.
  for (const row of body?.data?.data ?? []) {
    const preview = pickFile(row.file, ['sm', 'xs', 'md']);
    const full = pickFile(row.file, ['md', 'hd', 'sm']);
    if (!preview || !full) continue;
    items.push({ id: String(row.id ?? full.url), title: typeof row.title === 'string' ? row.title : '', previewUrl: preview.url, ...full });
  }
  return { items, hasNext: Boolean(body?.data?.has_next) };
};
