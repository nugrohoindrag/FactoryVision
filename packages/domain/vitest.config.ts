import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node', // pure logic — no DOM, by design (Tech Stack §3)
    include: ['test/**/*.test.ts'],
  },
});
