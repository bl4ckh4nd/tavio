import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const resolvePackageDir = (packageName) => {
  const packageParts = packageName.split('/');
  const directPath = path.join(rootDir, 'node_modules', ...packageParts);
  if (existsSync(directPath)) {
    return directPath;
  }

  const pnpmDir = path.join(rootDir, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) {
    throw new Error(`Unable to resolve ${packageName}: node_modules/.pnpm missing`);
  }

  const encodedName = packageName.replace('/', '+');
  const entry = readdirSync(pnpmDir).find((name) => name.startsWith(`${encodedName}@`));
  if (!entry) {
    throw new Error(`Unable to resolve ${packageName}: package not found in .pnpm store`);
  }

  const resolvedPath = path.join(pnpmDir, entry, 'node_modules', ...packageParts);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Unable to resolve ${packageName}: expected path missing (${resolvedPath})`);
  }

  return resolvedPath;
};

const copyFiles = (srcDir, destDir, filterFn = () => true) => {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    if (!filterFn(entry)) continue;
    cpSync(path.join(srcDir, entry), path.join(destDir, entry), { recursive: true });
  }
};

const publicMediaPipeDir = path.join(rootDir, 'public', 'mediapipe');
mkdirSync(publicMediaPipeDir, { recursive: true });

const tasksVisionDir = resolvePackageDir('@mediapipe/tasks-vision');

copyFiles(
  path.join(tasksVisionDir, 'wasm'),
  path.join(publicMediaPipeDir, 'tasks-vision', 'wasm'),
);

const modelDestDir = path.join(publicMediaPipeDir, 'models');
mkdirSync(modelDestDir, { recursive: true });

const taskModelUrl =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite';
const taskModelDest = path.join(modelDestDir, 'selfie_segmenter_landscape.tflite');

try {
  const response = await fetch(taskModelUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(taskModelDest, buffer);
} catch (err) {
  if (!existsSync(taskModelDest)) {
    throw new Error(
      `Failed to download task-compatible selfie segmenter model and no cached local copy exists: ${String(err)}`,
    );
  }
  console.warn(
    `[media:sync] Could not refresh selfie segmenter model from ${taskModelUrl}. Using existing local copy.`,
  );
}

console.log('LiveKit background processor assets synced to public/');
