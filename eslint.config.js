'use strict';

const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'src/renderer/vendor/**'],
  },
  {
    files: ['src/main/**/*.js', 'src/preload/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },
  {
    files: ['scripts/spotify-mock.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, __ipod: 'readonly' } },
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
    },
  },
];
