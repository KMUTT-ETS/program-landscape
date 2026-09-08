import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Until now `apps/web` ran vitest on defaults, which was fine while every test
// here was a pure-function or file-scanning test with relative imports. The
// Scholar panel tests render real components, and a component file imports
// `@/lib/...` — the same alias `tsconfig.json` declares. Without this map the
// import resolves to nothing and the test fails for a reason that has nothing
// to do with the component.
//
// The environment stays `node`: this workspace has no jsdom and no
// @testing-library, so component assertions go through
// `react-dom/server`'s renderToStaticMarkup, which needs no DOM. That rules
// out asserting click behaviour — the panel's state machine is a pure
// function (`src/lib/scholar-status.ts`) precisely so it can be tested
// exhaustively without one.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
