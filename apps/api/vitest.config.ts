import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    // Nest's class decorators need the legacy transform. Metadata emission is
    // deliberately absent — see the note in tsconfig.json.
    target: 'es2022',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    /**
     * Integration tests share one database per file and truncate between
     * cases; running files in parallel would have them truncating each other's
     * rows. Unit tests do not care, and there are not enough files here for the
     * serialisation to cost anything measurable.
     */
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
