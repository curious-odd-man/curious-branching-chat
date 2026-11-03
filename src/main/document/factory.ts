import { createDiscussion, type Author, type DomainContext } from '@shared/domain'
import { CURRENT_SCHEMA_VERSION, FORMAT_NAME, type DocumentContents } from '@shared/validation'

/** Contents of a brand-new, empty discussion (requirements 4.1). */
export function newDocumentContents(
  ctx: DomainContext,
  input: { title: string; author: Author; generator?: { name: string; version: string } }
): DocumentContents {
  return {
    manifest: {
      format: FORMAT_NAME,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      documentId: ctx.newId(),
      createdAt: ctx.now(),
      ...(input.generator ? { generator: input.generator } : {})
    },
    discussion: createDiscussion(ctx, { title: input.title, author: input.author }),
    readState: {}
  }
}
