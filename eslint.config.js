// Flat config (ESLint 10 + typescript-eslint 8).
//
// Rule tiering rationale: the `no-unsafe-*` / `no-explicit-any` family flags
// *type-system* weakness, not defects. Those sites are tracked as tech debt and
// burn down gradually, so they are warnings — they must not block CI. Rules that
// catch genuine bugs (floating promises, misused promises, unused bindings) stay
// errors and do fail the build.
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

      // --- Warnings: type-safety debt, tracked but non-blocking ---
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/require-await': 'warn',

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
