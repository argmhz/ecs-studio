import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url));
const editorRoot = fileURLToPath(new URL('./apps/editor/', import.meta.url));

export default defineConfig({
  root: editorRoot,
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist/', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: { index: `${editorRoot}index.html`, pong: `${editorRoot}pong.html`, 'framework-pilot': `${editorRoot}framework-pilot.html` } },
  },
  worker: { format: 'es' },
});
