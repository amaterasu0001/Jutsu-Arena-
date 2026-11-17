// Copies the MediaPipe Tasks WASM runtime from node_modules into public/ so the
// hand tracker loads it from this app instead of a CDN. Runs after `npm install`.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const target = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(source)) {
  console.warn('[mediapipe] @mediapipe/tasks-vision is not installed yet; skipping WASM copy.');
  process.exit(0);
}

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`[mediapipe] WASM runtime copied to ${target}`);
