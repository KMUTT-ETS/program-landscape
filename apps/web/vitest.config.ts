import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';
import path from 'node:path';

// Until now `apps/web` ran vitest on defaults, which was fine while every test
// here was a pure-function or file-scanning test with relative imports. The
// Scholar panel tests render real components, and a component file imports
// `@/lib/...` — the same alias `tsconfig.json` declares. Without the `resolve`
// map below the import resolves to nothing and the test fails for a reason
// that has nothing to do with the component.
//
// `include` MUST stay at least as wide as vitest's default. Tests live in two
// places in this package — `test/` and beside the source, as
// `src/lib/ai-settings-swap-guard.test.ts` does — and the first version of this
// file listed only `test/**`, which silently dropped that file's 8 tests from
// every run. `passWithNoTests` guarantees a narrowing like that never announces
// itself: the suite just gets smaller and still says "passed".
//
// `exclude` REPLACES vitest's defaults rather than extending them, so the
// defaults are spread back in explicitly — without that, node_modules and dist
// would be walked the moment `include` widened. For the same reason the
// package's `test` script is a bare `vitest run`: a CLI `--exclude` OVERRIDES
// this array rather than adding to it, so the flag it used to carry would have
// undone the spread from the outside.
//
// The environment stays `node`: this workspace has no jsdom and no
// @testing-library, so component assertions go through `react-dom/server`'s
// renderToStaticMarkup, which needs no DOM. That rules out asserting click
// behaviour — the Scholar panel's state machine is a pure function
// (`src/lib/scholar-status.ts`) precisely so it can be tested exhaustively
// without one.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts?(x)', 'src/**/*.test.ts?(x)', 'app/**/*.test.ts?(x)'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Next compiles JSX with the automatic runtime, so app files legitimately
  // use JSX without importing React — `app/admin/scholar/page.tsx` and every
  // other server component in `app/` do. Vitest's esbuild defaults to the
  // classic runtime, which turns that into `React is not defined` at render
  // time. Matching Next here is what lets a page component be imported and
  // called directly in a test (see scholar-admin-access.test.tsx); files that
  // still import React explicitly are unaffected.
  esbuild: { jsx: 'automatic' },
});
