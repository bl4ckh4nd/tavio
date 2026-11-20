import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fromNginx = Object.fromEntries(
  [...readFileSync('deploy/nginx.conf', 'utf8').matchAll(/add_header ([\w-]+) "(.+)" always;/g)].map(([, name, value]) => [name, value]),
);
const fromCloudflare = Object.fromEntries(
  [...readFileSync('public/_headers', 'utf8').matchAll(/^ {2}([\w-]+): (.+)$/gm)].map(([, name, value]) => [name, value]),
);

describe('production security headers', () => {
  it('are the same behind nginx and on Cloudflare', () => {
    expect(Object.keys(fromNginx)).toContain('Content-Security-Policy');
    expect(fromCloudflare).toEqual(fromNginx);
  });

  it('allow no inline script and no eval', () => {
    const scriptSrc = fromNginx['Content-Security-Policy'].split('; ').find((part: string) => part.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self' 'wasm-unsafe-eval'");
  });
});
