import { app } from 'electron'
import { join } from 'node:path'
import { FileAssociation, RegExeRegistry, type Registry } from './fileAssociation'

/**
 * The association for this run, or null where it cannot be managed: only an installed (packaged) Windows build owns
 * a stable program path to register. Test builds pass an in-memory registry instead.
 */
export function createFileAssociation(testRegistry: Registry | null): FileAssociation | null {
  if (testRegistry) {
    return new FileAssociation(testRegistry, 'C:\\Test\\BranchChat.exe', 'C:\\Test\\document.ico')
  }
  if (process.platform !== 'win32' || !app.isPackaged) return null
  return new FileAssociation(
    new RegExeRegistry(),
    process.execPath,
    join(process.resourcesPath, 'document.ico')
  )
}
