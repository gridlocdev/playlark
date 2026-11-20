import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Packages are used through their entry points (`src/index.ts`), never through their other source files. */
const DEEP_IMPORTS = {
  regex: '^(@playlark/[^/]+|(\\.\\./)+(packages/)?(core|node-files|ui))/src(?!/index\\.ts$)(/|$)',
  message: "Import from the package's entry point (@playlark/core, @playlark/node-files, @playlark/ui).",
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '.e2e-build/**',
      '**/out/**',
      '**/release/**',
      '**/.types/**',
      '**/.types-test/**',
      '.types-e2e/**',
      '.e2e-data/**',
      '.e2e-results/**',
      '.e2e-report/**',
      '.e2e-soak/**',
      '**/node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: [DEEP_IMPORTS] }],
    },
  },
  {
    // Typed rules: every promise is handled, and a switch over a union names every case.
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx,cts}'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
    },
  },
  {
    // Electron's sandboxed preload is CommonJS and may only require('electron'): require is the only way in.
    files: ['apps/desktop/src/preload.cts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // Build scripts run in Node.
    files: ['**/scripts/**/*.mjs', 'apps/cli/bin/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    // The engine must stay portable: browser, worker, Node, Electron renderer. Its tests run in Node.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'process'],
      'no-restricted-imports': [
        'error',
        { patterns: [DEEP_IMPORTS, { group: ['node:*', 'preact', 'preact/*', '@preact/*'] }] },
      ],
    },
  },
);
