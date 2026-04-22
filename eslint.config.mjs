// ESLint flat config — repo-wide rules.
//
// The main rule here is "no hardcoded colours in TS/TSX". Tokens live in
// packages/design/src/css/tokens.css and are referenced via Tailwind
// utilities (bg-surface-1, text-danger, etc.) or oklch(var(...)) in the
// token TS files themselves. The check below is a conservative regex —
// full CSS linting (hex in inline style attributes) will need stylelint
// later, but this catches the common mistakes in code review.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Match literal colours — NOT wrappers around CSS variables. `oklch(var(--x))`
// is the intended token-consumer form and must pass. We match:
//   - '#abc' / '#abcdef'   literal hex in string or template
//   - oklch(50% ...) / rgb(255 ...) etc — first arg is a digit (literal)
const COLOR_LITERAL = [
  'Literal[value=/^#([0-9a-fA-F]{3,8})$/]',
  'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}/]',
  'Literal[value=/(rgb|rgba|hsl|oklch|oklab)\\(\\s*\\d/]',
].join(', ');

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.config.{js,mjs,cjs,ts}',
      'eslint.config.mjs',
      // Token file may contain the raw CSS var triplets & rgb() for shadow alpha.
      'packages/design/src/**',
      // Page-level CSS is a token consumer; allowed to reference oklch() wrappers.
      'apps/web/app/globals.css',
      // Test data + seed fixtures occasionally use sample hexes.
      'packages/db/prisma/seed.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: COLOR_LITERAL,
          message:
            'Hardcoded colour literals are banned — use a design token (Tailwind utility like `bg-accent` or a CSS variable `oklch(var(--color-…))`).',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],
    },
  },
];
