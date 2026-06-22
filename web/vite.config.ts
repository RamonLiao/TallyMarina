import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    alias: [
      {
        find: /^.*\.(png|jpg|jpeg|gif|svg|webp)$/,
        replacement: resolve(__dirname, 'src/test/fileStub.ts'),
      },
    ],
  },
});
