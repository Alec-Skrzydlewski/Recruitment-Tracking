import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  { ignores: ['dist/**', 'dist-demo/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '18' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.mjs', 'scripts/**/*.mjs', '*.config.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Apps Script V8 runtime: Google services are globals; top-level functions
    // are entry points or called from other files' perspective.
    files: ['apps-script/**/*.gs'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        SpreadsheetApp: 'readonly', DriveApp: 'readonly', LockService: 'readonly', UrlFetchApp: 'readonly',
        ContentService: 'readonly', Utilities: 'readonly', PropertiesService: 'readonly', CacheService: 'readonly',
        console: 'readonly', module: 'writable',
      },
    },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^(doPost)$', caughtErrors: 'none' }] },
  },
]
