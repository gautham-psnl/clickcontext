import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ui\/shared$/, replacement: join(root, 'shared/src/index.ts') },
      { find: /^@ui\/shared\/(.*)$/, replacement: join(root, 'shared/src/$1') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The daemon store + MCP tool share one on-disk capture file (a singleton,
    // mirroring production's single daemon). Run test files sequentially so
    // their afterEach cleanups don't race on that shared path.
    fileParallelism: false,
  },
});
