import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Keeps the CDN fallback for the MediaPipe WASM runtime on the installed version.
const mediapipeVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf-8'),
).version;

// @mediapipe/tasks-vision 1.2.x ships `vision_bundle.mjs.map`, but the bundle's
// sourceMappingURL comment names `vision_bundle_mjs.js.map`, so the dev server
// logs ENOENT whenever the (unbundled, see optimizeDeps) module is served.
// Point the comment at the file that actually exists.
const mediapipeSourceMapFix: Plugin = {
  name: 'mediapipe-sourcemap-fix',
  apply: 'serve',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0];
    if (!file.replaceAll('\\', '/').endsWith('@mediapipe/tasks-vision/vision_bundle.mjs')) return null;
    const code = readFileSync(file, 'utf-8').replace('sourceMappingURL=vision_bundle_mjs.js.map', 'sourceMappingURL=vision_bundle.mjs.map');
    return { code, map: JSON.parse(readFileSync(`${file}.map`, 'utf-8')) };
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

  return {
    plugins: [react(), mediapipeSourceMapFix],
    optimizeDeps: {
      // MediaPipe Tasks ships a prebuilt, self-contained ES module (no imports of
      // its own), so it needs no pre-bundling. Serving it directly from
      // node_modules keeps hand tracking independent of Vite's deps cache.
      exclude: ['@mediapipe/tasks-vision'],
    },
    define: { __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion) },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      // The browser talks to /api on the dev server; Vite forwards it to FastAPI.
      proxy: { '/api': { target: backend, changeOrigin: true } },
    },
    preview: {
      port: 5173,
      proxy: { '/api': { target: backend, changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  };
});
