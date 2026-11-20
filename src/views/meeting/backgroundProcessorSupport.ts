import { supportsBackgroundProcessors } from '@livekit/track-processors';

let cachedSupport: boolean | undefined;

// ponytail: cache the capability probe because the dependency creates a WebGL
// context for each call; probe once per page to avoid exhausting browser limits.
export const hasBackgroundProcessorSupport = () => {
  cachedSupport ??= supportsBackgroundProcessors();
  return cachedSupport;
};
