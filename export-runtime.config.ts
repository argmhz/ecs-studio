import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const editorRoot = fileURLToPath(new URL('./apps/editor/', import.meta.url));

export default defineConfig({
  root: editorRoot,
  base: './',
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('./apps/editor/public/', import.meta.url)),
    emptyOutDir: false,
    assetsInlineLimit: 10_000_000,
    lib: { entry: fileURLToPath(new URL('./packages/browser-preview/src/standalone-player.ts', import.meta.url)), formats: ['iife'], name: 'EcsWebGame', fileName: () => 'export-runtime.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
    target: 'es2022',
  },
});
