// ESLint v9 flat config.
// Migrated from .eslintrc.cjs because ESLint v9 dropped legacy config support.
// See: https://eslint.org/docs/latest/use/configure/migration-guide

const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const globals = require('globals');

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.cjs', 'eslint.config.js', 'vitest.config.ts'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      // TypeScript itself catches undefined identifiers; eslint's no-undef
      // produces false positives on ambient types like RequestInit (from
      // lib.dom.d.ts) that have no runtime presence. Standard typescript-
      // eslint guidance is to disable no-undef for .ts files.
      'no-undef': 'off',
    },
  },
];
