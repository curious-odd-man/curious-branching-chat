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
    | 'KEYS_UNAVAILABLE'
    | 'WRITE_FAILED'
    | 'OWN_KEY'
    | 'INVALID_KEY'
    | 'NO_MEMBERS'
    | 'FILE_IN_SHARED_FOLDER'
    | 'FOLDER_TEST_FAILED'
    | 'FOLDER_IN_USE'
    | 'INVITATION_GONE'
    | 'NOT_SHARED'
    | 'ALREADY_MEMBER'
    | 'NOT_MEMBER'
    | 'SAME_KEY'

export class AppError extends Error {
    readonly code: AppErrorCode
    constructor(code: AppErrorCode, message: string) {
        super(message)
        this.name = 'AppError'
        this.code = code
    }
}
