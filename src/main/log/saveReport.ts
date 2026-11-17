import { app, BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { texts } from '@shared/i18n'
import type { Logger } from './logger'
import { writeReport } from './report'

export interface SaveReportDeps {
    logger: Logger
    userData: string
    appVersion: string
}

const readJson = async (path: string): Promise<unknown> =>
    JSON.parse(await fs.readFile(path, 'utf8')) as unknown

/**
 * FR-323: "Справка > Сохранить отчёт…". The person first sees what the report contains, then chooses where to save it.
 * The report never contains message text, names of discussions, or keys.
 */
export async function saveDiagnosticsReport(deps: SaveReportDeps): Promise<void> {
    const parent = BrowserWindow.getFocusedWindow() ?? undefined
    const box = {
        type: 'info' as const,
        title: texts().report.title,
        message: texts().report.title,
        detail: texts().report.contents,
        buttons: [texts().report.save, texts().report.cancel],
        defaultId: 0,
        cancelId: 1,
        noLink: true
    }
    const { response } = parent
        ? await dialog.showMessageBox(parent, box)
        : await dialog.showMessageBox(box)
    if (response !== 0) return

    const stamp = new Date().toISOString().slice(0, 10)
    const options = {
        title: texts().report.title,
        defaultPath: join(app.getPath('documents'), texts().report.fileName(stamp)),
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
    }
    const target = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
    if (target.canceled || !target.filePath) return

    deps.logger.area('app').info('diagnostics report requested')
    await deps.logger.flush()
    const syncDir = join(deps.userData, 'sync')
    const syncStates: Record<string, unknown> = {}
    for (const entry of await fs.readdir(syncDir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue
        const state = await readJson(join(syncDir, entry.name, 'state.json')).catch(() => null)
        if (state) syncStates[entry.name] = state
    }
    await writeReport(target.filePath, {
        logs: deps.logger.fileNames().map((name) => ({ name, path: join(deps.logger.dir, name) })),
        info: {
            appVersion: deps.appVersion,
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
            os: `${process.platform} ${release()}`,
            arch: process.arch,
            locale: app.getLocale(),
            createdAt: new Date().toISOString()
        },
        settings: await readJson(join(deps.userData, 'settings.json')).catch(() => null),
        registry: await readJson(join(syncDir, 'registry.json')).catch(() => null),
        syncStates
    })
    const done = {
        type: 'info' as const,
        title: texts().report.title,
        message: texts().report.saved,
        detail: target.filePath,
        buttons: ['OK'],
        noLink: true
    }
    if (parent) await dialog.showMessageBox(parent, done)
    else await dialog.showMessageBox(done)
}
