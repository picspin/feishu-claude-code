import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
  },
  server: {
    strictPort: true,
  },
});
