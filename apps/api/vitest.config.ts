import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// NestJS relies on decorator metadata at runtime; vitest/vite's default
// esbuild transform does NOT emit `design:type` metadata. We swap in the
// SWC plugin configured for emitDecoratorMetadata.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    setupFiles: ['reflect-metadata', './test/setup-organization.ts'],
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        target: 'es2022',
      },
    }),
  ],
});
