import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * The engine's exports whose type is not the same on its two builds: on
 * wgpu `createEngine` returns a Promise and a readback may park. The glue's
 * declarations are the WebGL build's, so these come from src/engine/wasm.ts,
 * typed for both.
 */
const ENGINE_GLUE = ['@lopsy/engine-pkg/lopsy_wasm', '@lopsy/engine-pkg/lopsy_wasm.js'];
const TWO_TYPED = [
  'createEngine',
  'exportPng16',
  'exportTiff16',
  'readDevelopHistogram',
  'readHdrHistogram',
  'readHdrOutputF32',
  'readSceneStatistics',
  'rendererName',
  'resumeTask',
  'sampleColor',
  'sampleNeutralWhiteBalance',
  'compositeForExport',
  'readCompositeThumbnail',
  'readLayerPixels',
  'readLayerPixelsLz4U16',
];
const TWO_TYPED_MESSAGE = 'Import it from src/engine/wasm.ts, which types it for both builds of the engine.';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'e2e/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      'playwright.config.ts',
      'vite.config.ts',
      'vitest.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': ['error', { paths: ENGINE_GLUE.map((name) => ({ name, importNames: TWO_TYPED, message: TWO_TYPED_MESSAGE })) }],
    },
  },
  {
    files: ['src/engine/wasm.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
