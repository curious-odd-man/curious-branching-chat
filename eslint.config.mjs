import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const nodeBuiltins = [
  'node:*',
  'fs',
  'fs/*',
  'path',
  'crypto',
  'os',
  'child_process',
  'zlib',
  'stream',
  'stream/*',
  'buffer',
  'util',
  'events',
  'http',
  'https',
  'net',
  'url'
]

const restrict = (message, group) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }]
})

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  // shared/: pure TypeScript — no Electron, React, Node built-ins, or imports from main/renderer
  {
    files: ['src/shared/**/*.ts'],
    rules: restrict(
      'src/shared must stay pure: no Electron, React, Node built-ins, main/ or renderer/ imports.',
      [
        'electron',
        'electron/*',
        'react',
        'react/*',
        'react-dom',
        'react-dom/*',
        ...nodeBuiltins,
        '**/main/**',
        '**/renderer/**',
        '**/preload/**'
      ]
    )
  },
  // renderer/: no Electron, no Node built-ins, no main/ imports
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: restrict(
      'The renderer may not use Electron, Node built-ins, or main/ code. Use the preload API.',
      ['electron', 'electron/*', ...nodeBuiltins, '**/main/**']
    )
  },
  // main/: no React, no renderer imports
  {
    files: ['src/main/**/*.ts'],
    rules: restrict('main/ may not import React or renderer code.', [
      'react',
      'react/*',
      'react-dom',
      'react-dom/*',
      '**/renderer/**'
    ])
  }
)
