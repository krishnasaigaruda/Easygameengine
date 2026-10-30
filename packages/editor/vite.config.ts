import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Rapier and Transformers.js (the picture reader) ship WASM; let Vite handle them as-is
  // instead of pre-bundling (which moves them away from their .wasm files).
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat', '@huggingface/transformers'] },
  // Fixed port so the editor doesn't collide with other local dev servers.
  server: { port: 5300, strictPort: true },
  build: {
    target: 'es2022',
    // Two pages: the editor, and the standalone player used by "Play in new tab".
    rollupOptions: { input: { main: 'index.html', play: 'play.html' } },
  },
});
