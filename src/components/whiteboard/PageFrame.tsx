import React from 'react';

/**
 * Nothing on the page may load from elsewhere or run: no scripts (the frame is sandboxed), no requests
 * (this policy), so a page someone pasted cannot track the others or reach the room.
 */
const GUARD = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;

/**
 * The policy comes first, before anything of the page: the parser puts it into the head, and whatever the page
 * says afterwards (its own doctype, head, a comment naming one) cannot move it out.
 */
export const guardedPage = (html: string) => `<!doctype html>${GUARD}${html}`;

export const PageFrame: React.FC<{ html: string; title: string }> = ({ html, title }) => (
  <iframe className="wb__page-frame" title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={guardedPage(html)} />
);
