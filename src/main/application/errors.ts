export type AppErrorCode =
    | 'NAME_REQUIRED'
    | 'IMAGE_READ_FAILED'
    | 'READ_NOTICE_REQUIRED'
    | 'UPDATE_NOT_SUPPORTED'
    | 'ASSOCIATION_BLOCKED'
    | 'ASSOCIATION_FAILED'
    | 'ASSOCIATION_UNSUPPORTED'
    | 'NO_DOCUMENT'
    | 'FORBIDDEN'
    | 'INVALID_REQUEST'

export class AppError extends Error {
    readonly code: AppErrorCode
    constructor(code: AppErrorCode, message: string) {
        super(message)
        this.name = 'AppError'
        this.code = code
    }
}
