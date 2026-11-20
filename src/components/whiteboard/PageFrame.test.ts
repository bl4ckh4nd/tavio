import { describe, expect, it } from 'vitest';
import { guardedPage } from './PageFrame';

/** The policy only works as a real element in the head; anywhere else (a comment, the body) the browser ignores it. */
const guardInHead = (html: string) =>
  !!new DOMParser().parseFromString(guardedPage(html), 'text/html').head.querySelector('meta[http-equiv="Content-Security-Policy"]');

describe('a pasted page keeps its guard', () => {
  it.each([
    ['a whole document', '<!doctype html><html><head><title>T</title></head><body><img src="https://t.example/p.png"></body></html>'],
    ['a bare fragment', '<h1>Hi</h1><img src="https://t.example/p.png">'],
    ['a head named in a comment first', '<!-- <head> --><!doctype html><html><head></head><body><img src="https://t.example/p.png"></body></html>'],
    ['a header before any head', '<header>Top</header><img src="https://t.example/p.png">'],
    ['a head after an image', '<img src="https://t.example/p.png"><head></head>'],
  ])('%s', (_name, html) => {
    expect(guardInHead(html)).toBe(true);
  });
});
