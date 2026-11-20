import type { SwitchBackgroundProcessorOptions } from '@livekit/track-processors';

export const BACKGROUND_PROCESSOR_ASSETS = {
  tasksVisionFileSet: '/mediapipe/tasks-vision/wasm',
  modelAssetPath: '/mediapipe/models/selfie_segmenter_landscape.tflite',
};

export const toBackgroundProcessorOptions = (bgValue: string): SwitchBackgroundProcessorOptions => {
  if (bgValue === 'none') return { mode: 'disabled' };
  if (bgValue === 'blur') return { mode: 'background-blur', blurRadius: 12 };
  return { mode: 'virtual-background', imagePath: bgValue };
};
