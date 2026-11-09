import type { BrowserWindow } from 'electron'
import type { AssociationInfo } from '@shared/types/ipc'
import { AppError } from '../application/errors'
import type { Ui } from '../application/ui'
import type { SettingsStore } from '../local-state/settings'
import { AssociationBlockedError, type FileAssociation } from './fileAssociation'

/**
 * Ties the file association to the person's choices (FR-089, FR-090, FR-136).
 * `association` is null when registration is not possible here (development run, other platform).
 */
export class AssociationService {
  constructor(
    private readonly association: FileAssociation | null,
    private readonly settings: SettingsStore,
    private readonly ui: Pick<Ui, 'confirmAssociation'>
  ) {}

  async info(): Promise<AssociationInfo> {
    if (!this.association) return { state: 'unsupported' }
    return { state: await this.association.state() }
  }

  async set(enabled: boolean): Promise<AssociationInfo> {
    if (!this.association)
      throw new AppError('ASSOCIATION_UNSUPPORTED', 'File association is not available')
    try {
      if (enabled) await this.association.enable()
      else await this.association.disable()
    } catch (err) {
      if (err instanceof AssociationBlockedError)
        throw new AppError('ASSOCIATION_BLOCKED', 'The file type belongs to another program')
      throw new AppError('ASSOCIATION_FAILED', 'Could not change the file association')
    }
    await this.settings.markAssociationAsked()
    return this.info()
  }

  /**
   * First start: ask once whether .branchchat files should open in BranchChat (FR-136). Nothing is asked if the
   * installer already asked, if the type is already associated (with BranchChat or another program), or after any
   * earlier answer. Never throws: a failure here must not stop the application.
   */
  async offerAtStartup(parent?: BrowserWindow): Promise<void> {
    if (!this.association) return
    try {
      if (this.settings.get().associationAsked) return
      if ((await this.association.wasAsked()) || (await this.association.state()) !== 'off') {
        await this.settings.markAssociationAsked()
        return
      }
      const yes = await this.ui.confirmAssociation(parent)
      await this.settings.markAssociationAsked()
      await this.association.markAsked()
      if (yes) await this.association.enable()
    } catch {
      // Ignored on purpose; the person can still use Settings.
    }
  }
}
