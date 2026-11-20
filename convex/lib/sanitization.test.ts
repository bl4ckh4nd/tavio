import { describe, expect, it } from 'vitest';
import { sanitizeHtml, sanitizePlainText } from './sanitization';

describe('sanitization', () => {
  it('sanitizes html and strips unsafe attributes/protocols', () => {
    const dirty = '<p>Hello</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>';
    const cleaned = sanitizeHtml(dirty);

    expect(cleaned).toContain('<p>Hello</p>');
    expect(cleaned).not.toContain('<script>');
    expect(cleaned).toContain('<a>');
    expect(cleaned).not.toContain('javascript:');
  });

  it('keeps the assistant marker on a block and drops any other value', () => {
    expect(sanitizeHtml('<ul data-assistant="blk-1a"><li>x</li></ul>')).toBe('<ul data-assistant="blk-1a"><li>x</li></ul>');
    expect(sanitizeHtml('<p data-assistant="x&quot; onclick=&quot;y" class="z">x</p>')).toBe('<p>x</p>');
    expect(sanitizeHtml('<p onclick="a" data-assistant="blk-2">x</p>')).toBe('<p data-assistant="blk-2">x</p>');
  });

  it('keeps entities that are already escaped instead of escaping them twice', () => {
    expect(sanitizeHtml('<p>a &lt; b &amp; c &#39;d&#39;</p>')).toBe('<p>a &lt; b &amp; c &#39;d&#39;</p>');
  });

  it('escapes plain text entities', () => {
    const cleaned = sanitizePlainText('<img src=x onerror=alert(1)>');
    expect(cleaned).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});
