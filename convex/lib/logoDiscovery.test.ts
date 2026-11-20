import { describe, expect, it } from 'vitest';
import { extractLogoCandidates } from './logoDiscovery';

describe('logo discovery', () => {
  it('prioritizes explicit logo-like assets over favicons and social banners', () => {
    const html = `
      <html>
        <head>
          <link rel="icon" href="/favicon.ico" sizes="32x32" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
          <meta property="og:image" content="https://cdn.example.com/social-banner.jpg" />
        </head>
        <body>
          <header>
            <img src="/assets/company-logo.svg" alt="Example company logo" />
          </header>
        </body>
      </html>
    `;

    const candidates = extractLogoCandidates(html, 'https://example.com');

    expect(candidates[0]).toMatchObject({
      url: 'https://example.com/assets/company-logo.svg',
      source: 'img-logo',
    });
    expect(candidates.some(candidate => candidate.url === 'https://example.com/favicon.ico')).toBe(true);
  });

  it('resolves relative URLs against the fetched page URL', () => {
    const html = `
      <html>
        <head>
          <link rel="icon" href="../icons/brand-mark.png" />
        </head>
      </html>
    `;

    const candidates = extractLogoCandidates(html, 'https://example.com/company/about');

    expect(candidates[0]?.url).toBe('https://example.com/icons/brand-mark.png');
  });
});
