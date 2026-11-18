import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
    resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
    oxc: { jsx: { runtime: 'automatic' } },
    test: {
        include: ['tests/**/*.test.{ts,tsx}'],
        environment: 'node',
        // The sync tests write, rename, and fsync many real files. On the Windows runner of the release pipeline,
        // virus scanning and file locks make that 10 to 20 times slower than on Linux (about 0.3 s here, more than
        // the default 5 s there). A real hang still fails.
        testTimeout: 30_000,
        hookTimeout: 30_000,
        // code review T-4: a report only (`npm run test:coverage`), no limit yet
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.d.ts'],
            reporter: ['text-summary', 'html', 'json-summary'],
            reportsDirectory: 'coverage'
        }
    }
})
