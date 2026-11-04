export type DomainErrorCode =
  | 'THREAD_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'EMPTY_QUOTE'
  | 'EMPTY_MESSAGE'
  | 'UNKNOWN_ASSET'
  | 'MAIN_THREAD_NOT_CLOSABLE'
  | 'INVALID_SELECTION'
  | 'THREAD_CLOSED'

export class DomainError extends Error {
  readonly code: DomainErrorCode
  constructor(code: DomainErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
