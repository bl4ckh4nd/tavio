/**
 * Sanitization utilities for preventing XSS attacks.
 * Lightweight sanitizer that does not require Node.js APIs.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'span', 'div'
]);

const MARKED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote']);

const SAFE_URL_REGEX = /^(?:(?:https?|mailto|tel):|\/|#)/i;

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// Text in HTML already carries its entities (TipTap writes "&lt;" for "<"); escaping those again shows them literally.
const escapeHtmlText = (value: string): string =>
  escapeHtml(value).replace(/&amp;(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, '&$1;');

const sanitizeTag = (rawTag: string): string => {
  const match = rawTag.match(/^<\s*\/?\s*([a-zA-Z0-9-]+)([^>]*)>$/);
  if (!match) return '';

  const tagName = match[1].toLowerCase();
  const attrs = match[2] || '';
  const isClosing = /^<\s*\//.test(rawTag);

  if (!ALLOWED_TAGS.has(tagName)) return '';

  if (isClosing) {
    return `</${tagName}>`;
  }

  if (tagName === 'br') {
    return '<br />';
  }

  if (tagName === 'a') {
    const hrefMatch = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = hrefMatch ? (hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || '') : '';
    if (!href || !SAFE_URL_REGEX.test(href)) {
      return '<a>';
    }
    return `<a href="${escapeHtml(href)}">`;
  }

  // The assistant marks the blocks it wrote, so an undo can find them again.
  const marker = MARKED_TAGS.has(tagName) ? attrs.match(/(?:^|\s)data-assistant="([a-z0-9-]{1,64})"(?=\s|\/|$)/) : null;
  return marker ? `<${tagName} data-assistant="${marker[1]}">` : `<${tagName}>`;
};

/**
 * Sanitize HTML content for meeting notes.
 * Keeps a small allowlist of tags; strips attributes except safe href on links.
 */
export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';
  const parts = dirty.split(/(<[^>]+>)/g);
  return parts
    .map((part) => {
      if (part.startsWith('<') && part.endsWith('>')) {
        return sanitizeTag(part);
      }
      return escapeHtmlText(part);
    })
    .join('');
}

/**
 * Sanitize plain text for chat messages.
 * Escapes all HTML entities to prevent any HTML rendering.
 */
export function sanitizePlainText(text: string): string {
  return escapeHtml(text || '');
}
