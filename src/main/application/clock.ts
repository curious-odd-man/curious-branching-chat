import { randomUUID } from 'node:crypto'
import type { DomainContext } from '@shared/domain'

export const systemContext: DomainContext = {
  now: () => new Date().toISOString(),
  newId: () => randomUUID()
}
