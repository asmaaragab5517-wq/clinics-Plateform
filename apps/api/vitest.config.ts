import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { testTimeout: 30000, hookTimeout: 180000, fileParallelism: false, pool: 'forks' },
});
