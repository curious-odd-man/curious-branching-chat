import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

/** Strict Content Security Policy for the packaged app (ADR 7.1). Not applied in dev: the dev server needs inline scripts and websockets. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: bcasset:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ')

export default defineConfig(({ mode }) => ({
  main: {
    resolve: { alias },
    // End-to-end hooks exist only in `electron-vite build --mode e2e`.
    define: { __E2E_HOOKS__: JSON.stringify(mode === 'e2e') }
  },
  preload: { resolve: { alias } },
  renderer: {
    resolve: { alias },
    plugins: [
      react(),
      {
        name: 'inject-csp',
        apply: 'build',
        transformIndexHtml: () => [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
            injectTo: 'head-prepend'
          }
        ]
      }
    ]
  }
}))
