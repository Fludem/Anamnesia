import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev pages (dev/icons.html, dev/items.html) are only entries in dev/serve mode.
// Production builds contain the game entry only, so the full 4k-icon index
// can never leak into the shipped bundle.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  build: {
    rollupOptions: {
      input:
        command === 'serve'
          ? {
              main: resolve(import.meta.dirname, 'index.html'),
              icons: resolve(import.meta.dirname, 'dev/icons.html'),
              items: resolve(import.meta.dirname, 'dev/items.html'),
            }
          : { main: resolve(import.meta.dirname, 'index.html') },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
}));
