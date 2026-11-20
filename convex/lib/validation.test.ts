import { describe, expect, it } from 'vitest';
import { normalizeWebsiteUrl, validateSlug, validateUrl } from './validation';

describe('validation', () => {
  it('accepts valid slug', () => {
    expect(() => validateSlug('team-room-1')).not.toThrow();
  });

  it('rejects invalid slug formats and length', () => {
    expect(() => validateSlug('AB')).toThrow();
    expect(() => validateSlug('bad_slug')).toThrow();
    expect(() => validateSlug('UPPERCASE')).toThrow();
  });

  it('rejects unsafe and malformed URLs', () => {
    expect(() => validateUrl('javascript:alert(1)', 'Logo URL')).toThrow();
    expect(() => validateUrl('not a url', 'Logo URL')).toThrow();
    expect(() => validateUrl('https://example.com', 'Logo URL')).not.toThrow();
  });

  it('normalizes partner website domains to https URLs', () => {
    expect(normalizeWebsiteUrl('example.com')).toBe('https://example.com/');
    expect(normalizeWebsiteUrl('https://partner.example.com/about')).toBe('https://partner.example.com/about');
  });
});
