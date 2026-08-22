import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// The simulation and runtime layers must be deterministic and testable without a browser:
// every clock, timer and storage API is injected through src/runtime/env.ts. These rules turn
// that requirement into a build failure instead of a convention.
const wallClockRules = {
  'no-restricted-properties': [
    'error',
    { object: 'Date', property: 'now', message: 'Use the injected clock (env.clock.now()).' },
    { object: 'Math', property: 'random', message: 'Use the seeded PRNG in src/sim/rng.ts.' },
    { object: 'performance', property: 'now', message: 'Use the injected clock.' },
    { object: 'crypto', property: 'randomUUID', message: 'Inject via env.' },
    { object: 'crypto', property: 'getRandomValues', message: 'Inject via env.' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'new Date() reads the wall clock; use the injected clock.',
    },
  ],
  'no-restricted-globals': [
    'error',
    ...['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame'].map(
      (name) => ({
        name,
        message: 'Timers are injected through env.scheduler / env.yieldToEventLoop.',
      }),
    ),
    ...[
      'navigator',
      'window',
      'document',
      'indexedDB',
      'localStorage',
      'sessionStorage',
      'location',
      'BroadcastChannel',
    ].map((name) => ({ name, message: 'Browser APIs are injected through src/runtime/env.ts.' })),
  ],
};

export default tseslint.config(
  { ignores: ['dist', 'vendor', 'node_modules', 'src/assets', '.claude'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/sim/**/*.ts', 'src/runtime/**/*.ts'],
    ignores: ['src/runtime/env.ts', 'src/runtime/testing/**', '**/*.test.ts'],
    rules: wallClockRules,
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: 'The sim has no UI dependency.' },
            {
              group: ['../runtime/*', '../ui/*', '../icons/*', '../dev/*'],
              message: 'The sim must not depend on other layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.tsx', 'dev/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
