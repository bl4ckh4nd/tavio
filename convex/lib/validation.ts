/**
 * Input validation utilities for Convex mutations/queries.
 * Throws descriptive errors on validation failure.
 */

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CHAT_MESSAGE_LENGTH = 5000;
const MAX_MEETING_DOC_LENGTH = 500000; // ~500KB
const MAX_ROOM_NAME_LENGTH = 100;
const MAX_SLUG_LENGTH = 50;
const MAX_URL_LENGTH = 2048;
const HTTP_PROTOCOL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

/**
 * Validate room slug format.
 * Must be lowercase alphanumeric with hyphens, 3-50 characters.
 *
 * @param slug - Room slug to validate
 * @throws Error if slug is invalid
 */
export function validateSlug(slug: string): void {
  if (!slug || slug.length < 3 || slug.length > MAX_SLUG_LENGTH) {
    throw new Error(`Slug must be between 3 and ${MAX_SLUG_LENGTH} characters`);
  }
  if (!SLUG_REGEX.test(slug)) {
    throw new Error('Slug must be lowercase letters, numbers, and hyphens only');
  }
}

/**
 * Validate URL is safe (http/https only, no javascript: or data:).
 *
 * @param url - URL to validate
 * @param fieldName - Name of field for error messages
 * @throws Error if URL is invalid or uses unsafe protocol
 */
export function validateUrl(url: string, fieldName: string = 'URL'): void {
  if (!url) return; // Optional URLs can be empty

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(`${fieldName} exceeds maximum length of ${MAX_URL_LENGTH}`);
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`${fieldName} must use http or https protocol`);
    }
  } catch (e) {
    throw new Error(`${fieldName} is not a valid URL`);
  }
}

/**
 * Normalize partner website input so domains like "example.com" become https URLs.
 *
 * @param url - Website input from user
 * @returns A normalized http/https URL string
 * @throws Error if the URL cannot be normalized safely
 */
export function normalizeWebsiteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Partner website URL cannot be empty');
  }

  const withProtocol = HTTP_PROTOCOL_REGEX.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Partner website URL must use http or https protocol');
    }
    parsed.hash = '';
    return parsed.toString();
  } catch (_error) {
    throw new Error('Partner website URL is not a valid URL');
  }
}

/**
 * Validate text length constraints.
 *
 * @param text - Text to validate
 * @param maxLength - Maximum allowed length
 * @param fieldName - Name of field for error messages
 * @throws Error if text exceeds maximum length
 */
export function validateTextLength(
  text: string,
  maxLength: number,
  fieldName: string = 'Text'
): void {
  if (text.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
  }
}

/**
 * Validate chat message.
 *
 * @param text - Chat message text
 * @throws Error if message is empty or too long
 */
export function validateChatMessage(text: string): void {
  if (!text || text.trim().length === 0) {
    throw new Error('Chat message cannot be empty');
  }
  validateTextLength(text, MAX_CHAT_MESSAGE_LENGTH, 'Chat message');
}

/**
 * Validate meeting doc content.
 *
 * @param html - Meeting document HTML
 * @throws Error if document is too large
 */
export function validateMeetingDoc(html: string): void {
  validateTextLength(html, MAX_MEETING_DOC_LENGTH, 'Meeting document');
}

/**
 * Validate room name.
 *
 * @param name - Room name
 * @throws Error if name is empty or too long
 */
export function validateRoomName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error('Room name cannot be empty');
  }
  validateTextLength(name, MAX_ROOM_NAME_LENGTH, 'Room name');
}

/**
 * Validate hex color code.
 *
 * @param color - Hex color string (e.g., #FF5733)
 * @throws Error if color format is invalid
 */
export function validateHexColor(color: string): void {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw new Error('Color must be a valid hex code (e.g., #FF5733)');
  }
}

/**
 * Exported constants for use in other modules
 */
export const LIMITS = {
  MAX_CHAT_MESSAGE_LENGTH,
  MAX_MEETING_DOC_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_SLUG_LENGTH,
  MAX_URL_LENGTH
} as const;
