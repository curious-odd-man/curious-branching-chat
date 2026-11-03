export type AppErrorCode = 'NAME_REQUIRED' | 'NO_DOCUMENT' | 'FORBIDDEN' | 'INVALID_REQUEST'

export class AppError extends Error {
  readonly code: AppErrorCode
  constructor(code: AppErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}
