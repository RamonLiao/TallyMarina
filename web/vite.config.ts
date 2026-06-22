/// <reference types="vitest/config" />
/// <reference types="node" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
        replacement: path.resolve(__dirname, 'src/test/fileStub.ts'),
      },
    ],
  },
});
