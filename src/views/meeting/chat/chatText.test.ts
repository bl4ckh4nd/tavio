import { describe, expect, it } from 'vitest';
import { decodeStoredText, isEmojiOnly, parseChatText, replaceShortcodes } from './chatText';

const linksIn = (text: string) => {
  const found: Array<{ href: string; text: string }> = [];
  const walk = (nodes: any[]) => nodes.forEach((node) => {
    if (node.type === 'link') found.push({ href: node.href, text: node.text });
    if (node.children) walk(node.children);
  });
  walk(parseChatText(text));
  return found;
};

describe('chat text', () => {
  it('links a URL whose query was stored escaped', () => {
    const stored = 'see https://example.com/a?x=1&amp;y=2 now';

    expect(linksIn(decodeStoredText(stored))).toEqual([
      { href: 'https://example.com/a?x=1&y=2', text: 'https://example.com/a?x=1&y=2' },
    ]);
  });

  it('leaves closing punctuation outside the link and keeps balanced brackets inside', () => {
    expect(linksIn('look: https://example.com/page.')[0].href).toBe('https://example.com/page');
    expect(linksIn('(see https://example.com/x)')[0].href).toBe('https://example.com/x');
    expect(linksIn('https://en.wikipedia.org/wiki/Foo_(bar)')[0].href).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });

  it('links www addresses over https and nothing that is not http(s)', () => {
    expect(linksIn('go to www.example.org')).toEqual([{ href: 'https://www.example.org', text: 'www.example.org' }]);
    expect(linksIn('javascript:alert(1) data:text/html,x ftp://x.org')).toEqual([]);
  });

  it('formats bold, italic, strike and code, and does not link inside code', () => {
    expect(parseChatText('**big** _soft_ ~~gone~~ `https://example.com`')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'bold', children: [{ type: 'text', text: 'big' }] },
          { type: 'text', text: ' ' },
          { type: 'italic', children: [{ type: 'text', text: 'soft' }] },
          { type: 'text', text: ' ' },
          { type: 'strike', children: [{ type: 'text', text: 'gone' }] },
          { type: 'text', text: ' ' },
          { type: 'code', text: 'https://example.com' },
        ],
      },
    ]);
  });

  it('leaves snake_case, arithmetic and URLs with underscores alone', () => {
    expect(parseChatText('my_var_name and 2 * 3 * 4')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'my_var_name and 2 * 3 * 4' }] },
    ]);
    expect(linksIn('https://example.com/a_b_c')[0].href).toBe('https://example.com/a_b_c');
  });

  it('keeps a fenced code block verbatim, line breaks and all', () => {
    expect(parseChatText('before\n```\nconst a = **1**;\n  b()\n```\nafter')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'before' }] },
      { type: 'codeblock', text: 'const a = **1**;\n  b()' },
      { type: 'paragraph', children: [{ type: 'text', text: 'after' }] },
    ]);
  });

  it('keeps line breaks inside a paragraph', () => {
    expect(parseChatText('one\ntwo')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'one' }, { type: 'break' }, { type: 'text', text: 'two' }] },
    ]);
  });

  it('shows a message of a few emoji larger', () => {
    expect(isEmojiOnly('🎉')).toBe(true);
    expect(isEmojiOnly('👍🏽 ❤️')).toBe(true);
    expect(isEmojiOnly('hi 🎉')).toBe(false);
    expect(isEmojiOnly('1')).toBe(false);
    expect(isEmojiOnly('🎉🎉🎉🎉🎉🎉🎉🎉🎉')).toBe(false);
  });

  it('turns known shortcodes into emoji and leaves unknown ones and times alone', () => {
    expect(replaceShortcodes('nice :thumbsup: :tada: :nope: at 10:30:00')).toBe('nice 👍 🎉 :nope: at 10:30:00');
  });
});
