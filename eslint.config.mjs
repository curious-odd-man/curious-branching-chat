import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
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
        // local replacements for deprecated packages (package.json overrides): plain CommonJS for Node
        files: ['shims/**/*.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: { require: 'readonly', module: 'writable' }
        },
        rules: { '@typescript-eslint/no-require-imports': 'off' }
    },
    // type-aware rules (code review T-1): promises, assertions, exhaustive switches
    {
        files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                project: [
                    './tsconfig.node.json',
                    './tsconfig.web.json',
                    './tests/e2e/tsconfig.json',
                    './tests/renderer/tsconfig.json'
                ],
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': [
                'error',
                { considerDefaultExhaustiveForUnions: true }
            ]
        }
    },
    // React hooks (code review T-2)
    {
        files: ['src/renderer/**/*.tsx', 'src/renderer/**/*.ts'],
        plugins: { 'react-hooks': reactHooks },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'error'
        }
    },
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
