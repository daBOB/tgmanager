// Flat config (ESLint 10 + typescript-eslint 8).
//
// The `no-unsafe-*` / `no-explicit-any` family was tiered down to warnings while
// a backlog of untyped sites burned down. That backlog is now empty, so the
// rules are errors: src/ reaches zero, and the gate keeps it there rather than
// letting `any` creep back one warning at a time.
//
// Where an external library genuinely has no usable type — gramjs returns broad
// unions and omits its EventEmitter surface — the fix is a narrow local
// interface and a checked cast at the boundary, not a blanket `any`.
//
// Tests keep the looser settings below: test doubles must be free to fake
// loosely-typed API shapes.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'eslint.config.js'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      // --- Errors: real defects ---
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'prefer-const': 'error',
      'no-var': 'error',

      // --- Errors: type-safety floor, currently at zero ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/require-await': 'error',

      // CLI writes user-facing output through src/utils/console-output.ts;
      // that module is the single allowed console site (see override below).
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // The output module owns stdout/stderr for the CLI by design.
    files: ['src/utils/console-output.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node, ...globals.vitest },
    },
    rules: {
      // Test doubles legitimately fake loosely-typed Telegram API shapes, and
      // mock methods stay `async` to match the real signatures they stand in for.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'off',
    },
  },
);
