import { isReactionEmoji } from '../../../../convex/lib/chatMedia';

// Chat text is plain text with a little Markdown. It is parsed into nodes that React renders as
// elements, never into HTML, so a message cannot inject markup.

export type ChatInline =
  | { type: 'text'; text: string }
  | { type: 'break' }
  | { type: 'link'; href: string; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold' | 'italic' | 'strike'; children: ChatInline[] };

export type ChatBlock =
  | { type: 'paragraph'; children: ChatInline[] }
  | { type: 'codeblock'; text: string };

// chat.send stores HTML-escaped text; undo the stored entities before parsing and showing it.
export const decodeStoredText = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const INLINE_PATTERNS: Array<{ type: 'code' | 'link' | 'bold' | 'strike' | 'italic'; re: RegExp }> = [
  { type: 'code', re: /`([^`\n]+)`/ },
  { type: 'link', re: /\b(?:https?:\/\/|www\.)[^\s<>"]+/i },
  { type: 'bold', re: /\*\*(?=\S)(.+?)(?<=\S)\*\*/ },
  { type: 'strike', re: /~~(?=\S)(.+?)(?<=\S)~~/ },
  { type: 'italic', re: /(?<![\p{L}\p{N}_*])([_*])(?=\S)(.*?\S)\1(?![\p{L}\p{N}_*])/u },
];

const TRAILING_PUNCTUATION = '.,;:!?\'")]}';

// A URL ends before closing punctuation, unless the bracket opened inside the URL.
const trimUrl = (raw: string) => {
  let url = raw;
  while (url && TRAILING_PUNCTUATION.includes(url[url.length - 1])) {
    const last = url[url.length - 1];
    const opener = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : null;
    if (opener && url.split(opener).length > url.split(last).length - 1) break;
    url = url.slice(0, -1);
  }
  return url;
};

const toHref = (text: string) => {
  const candidate = /^www\./i.test(text) ? `https://${text}` : text;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? candidate : null;
  } catch {
    return null;
  }
};

const pushText = (nodes: ChatInline[], text: string) => {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === 'text') last.text += text;
  else nodes.push({ type: 'text', text });
};

const parseInline = (input: string): ChatInline[] => {
  const nodes: ChatInline[] = [];
  let rest = input;
  while (rest) {
    let best: { type: (typeof INLINE_PATTERNS)[number]['type']; match: RegExpExecArray } | null = null;
    for (const { type, re } of INLINE_PATTERNS) {
      const match = re.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { type, match };
    }
    if (!best) {
      pushText(nodes, rest);
      break;
    }
    const { type, match } = best;
    pushText(nodes, rest.slice(0, match.index));
    let consumed = match[0].length;
    if (type === 'code') {
      nodes.push({ type: 'code', text: match[1] });
    } else if (type === 'link') {
      const text = trimUrl(match[0]);
      const href = toHref(text);
      consumed = text.length || match[0].length;
      if (href && text) nodes.push({ type: 'link', href, text });
      else pushText(nodes, match[0].slice(0, consumed));
    } else if (type === 'italic') {
      nodes.push({ type: 'italic', children: parseInline(match[2]) });
    } else {
      nodes.push({ type, children: parseInline(match[1]) });
    }
    rest = rest.slice(match.index + consumed);
  }
  return nodes;
};

const parseParagraph = (text: string): ChatBlock | null => {
  const trimmed = text.replace(/^\n+|\n+$/g, '');
  if (!trimmed) return null;
  const children: ChatInline[] = [];
  trimmed.split('\n').forEach((line, index) => {
    if (index > 0) children.push({ type: 'break' });
    children.push(...parseInline(line));
  });
  return { type: 'paragraph', children };
};

export const parseChatText = (text: string): ChatBlock[] => {
  const blocks: ChatBlock[] = [];
  const fence = /```[^\n`]*\n?([\s\S]*?)```/g;
  let cursor = 0;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    const before = parseParagraph(text.slice(cursor, match.index));
    if (before) blocks.push(before);
    blocks.push({ type: 'codeblock', text: match[1].replace(/\n$/, '') });
    cursor = match.index + match[0].length;
  }
  const after = parseParagraph(text.slice(cursor));
  if (after) blocks.push(after);
  return blocks;
};

const graphemes = (text: string) =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);

/** A message of one to eight emoji and nothing else is shown larger. */
export const isEmojiOnly = (text: string) => {
  const parts = graphemes(text.replace(/\s+/g, ''));
  return parts.length > 0 && parts.length <= 8 && parts.every(isReactionEmoji);
};

const SHORTCODES: Record<string, string> = {
  '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', ok_hand: '👌', clap: '👏', wave: '👋', pray: '🙏',
  raised_hands: '🙌', muscle: '💪', point_up: '☝️', eyes: '👀', smile: '😄', smiley: '😃', grin: '😁', joy: '😂',
  rofl: '🤣', laughing: '😆', wink: '😉', blush: '😊', slightly_smiling_face: '🙂', upside_down_face: '🙃',
  heart_eyes: '😍', kissing_heart: '😘', thinking: '🤔', thinking_face: '🤔', neutral_face: '😐', expressionless: '😑',
  roll_eyes: '🙄', smirk: '😏', grimacing: '😬', relieved: '😌', pensive: '😔', sleeping: '😴', sweat_smile: '😅',
  cry: '😢', sob: '😭', scream: '😱', angry: '😠', rage: '😡', sunglasses: '😎', nerd_face: '🤓', partying_face: '🥳',
  exploding_head: '🤯', facepalm: '🤦', shrug: '🤷', heart: '❤️', broken_heart: '💔', fire: '🔥', sparkles: '✨',
  star: '⭐', tada: '🎉', rocket: '🚀', '100': '💯', check: '✅', white_check_mark: '✅', x: '❌', warning: '⚠️',
  question: '❓', exclamation: '❗', bulb: '💡', coffee: '☕', beers: '🍻', pizza: '🍕', cake: '🍰', zap: '⚡',
  sunny: '☀️', rainbow: '🌈', see_no_evil: '🙈', poop: '💩', skull: '💀', ghost: '👻', robot: '🤖', memo: '📝',
  calendar: '📅', clock: '🕐', hourglass: '⏳', link: '🔗', lock: '🔒', bug: '🐛', wrench: '🔧', chart: '📈',
};

/** `:tada:` becomes 🎉. Unknown codes stay as typed. */
export const replaceShortcodes = (text: string) =>
  text.replace(/:([a-z0-9_+-]+):/gi, (whole, code: string) => SHORTCODES[code.toLowerCase()] ?? whole);
