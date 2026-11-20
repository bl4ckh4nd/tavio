export type LogoCandidate = {
  url: string;
  source:
    | 'apple-touch-icon'
    | 'icon'
    | 'mask-icon'
    | 'meta-image'
    | 'img-logo'
    | 'img'
    | 'favicon-fallback';
  score: number;
};

const ATTRIBUTE_REGEX = /([^\s=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const parseAttributes = (tagSource: string) => {
  const attributes: Record<string, string> = {};

  for (const match of tagSource.matchAll(ATTRIBUTE_REGEX)) {
    const key = match[1]?.toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    if (!key || key === tagSource.toLowerCase()) {
      continue;
    }
    attributes[key] = value;
  }

  return attributes;
};

const addCandidate = (
  candidates: LogoCandidate[],
  seen: Set<string>,
  rawUrl: string | null | undefined,
  pageUrl: string,
  source: LogoCandidate['source'],
  baseScore: number,
  sizeHint?: string | null,
) => {
  if (!rawUrl) return;

  try {
    const resolved = new URL(rawUrl, pageUrl).toString();
    if (!['http:', 'https:'].includes(new URL(resolved).protocol)) {
      return;
    }

    const normalized = resolved.toLowerCase();
    if (seen.has(normalized)) {
      return;
    }
    seen.add(normalized);

    let score = baseScore;

    if (normalized.includes('logo')) score += 45;
    if (normalized.includes('brand')) score += 12;
    if (normalized.includes('favicon')) score -= 28;
    if (normalized.endsWith('.svg')) score += 40;
    if (normalized.endsWith('.png')) score += 20;
    if (normalized.endsWith('.webp')) score += 14;
    if (normalized.endsWith('.ico')) score -= 18;

    if (sizeHint) {
      const match = sizeHint.match(/(\d+)\s*x\s*(\d+)/i);
      const largest = match ? Math.max(Number(match[1]), Number(match[2])) : 0;
      if (largest >= 180) score += 24;
      else if (largest >= 96) score += 16;
      else if (largest >= 48) score += 8;
    }

    candidates.push({ url: resolved, source, score });
  } catch (_error) {
    // Ignore malformed candidate URLs and continue with the next heuristic.
  }
};

export const extractLogoCandidates = (html: string, pageUrl: string): LogoCandidate[] => {
  const candidates: LogoCandidate[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const rel = (attrs.rel || '').toLowerCase();
    const href = attrs.href;

    if (rel.includes('apple-touch-icon')) {
      addCandidate(candidates, seen, href, pageUrl, 'apple-touch-icon', 140, attrs.sizes);
      continue;
    }

    if (rel.includes('mask-icon')) {
      addCandidate(candidates, seen, href, pageUrl, 'mask-icon', 100, attrs.sizes);
      continue;
    }

    if (rel.includes('icon')) {
      addCandidate(candidates, seen, href, pageUrl, 'icon', 112, attrs.sizes);
    }
  }

  for (const match of html.matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    addCandidate(candidates, seen, attrs.content, pageUrl, 'meta-image', 78);
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const markerText = `${attrs.alt || ''} ${attrs.class || ''} ${attrs.id || ''} ${attrs.src || ''}`.toLowerCase();
    const looksLikeLogo = markerText.includes('logo') || markerText.includes('brand');
    addCandidate(
      candidates,
      seen,
      attrs.src,
      pageUrl,
      looksLikeLogo ? 'img-logo' : 'img',
      looksLikeLogo ? 132 : 22,
    );
  }

  addCandidate(candidates, seen, '/favicon.ico', pageUrl, 'favicon-fallback', 12);

  return candidates.sort((a, b) => b.score - a.score);
};
