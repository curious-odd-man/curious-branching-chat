/** Injected so the domain stays deterministic and testable. */
export interface DomainContext {
  /** Current time as ISO-8601 UTC, e.g. 2026-11-02T10:15:00.000Z */
  now(): string
  /** A new unique identifier (UUID). */
  newId(): string
}

/** The person performing an action. */
export interface Author {
  participantId: string
  displayName: string
}
