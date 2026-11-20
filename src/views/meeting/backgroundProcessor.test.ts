import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toBackgroundProcessorOptions } from './backgroundProcessorOptions';

describe('background processor mode switches', () => {
  it('starts with disabled output and supports LiveKit blur and image modes', () => {
    expect(toBackgroundProcessorOptions('none')).toEqual({ mode: 'disabled' });
    expect(toBackgroundProcessorOptions('blur')).toEqual({ mode: 'background-blur', blurRadius: 12 });
    expect(toBackgroundProcessorOptions('/custom-background.png')).toEqual({
      mode: 'virtual-background',
      imagePath: '/custom-background.png',
    });
  });

  it('runs the patched LiveKit processor, which only pnpm installs apply', () => {
    const dist = path.dirname(createRequire(import.meta.url).resolve('@livekit/track-processors'));
    for (const file of ['index.js', 'index.mjs']) {
      expect(readFileSync(path.join(dist, file), 'utf8')).toContain('maskRefineFragmentShader');
    }
  });
});
