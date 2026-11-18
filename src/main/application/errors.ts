import { CodedError } from '@shared/errors'

export const APP_ERROR_CODES = [
    'NAME_REQUIRED',
    'IMAGE_READ_FAILED',
    'READ_NOTICE_REQUIRED',
    'UPDATE_NOT_SUPPORTED',
    'ASSOCIATION_BLOCKED',
    'ASSOCIATION_FAILED',
    'ASSOCIATION_UNSUPPORTED',
    'NO_DOCUMENT',
    'FORBIDDEN',
    'INVALID_REQUEST',
    'KEYS_UNAVAILABLE',
    'WRITE_FAILED',
    'OWN_KEY',
    'INVALID_KEY',
    'NO_MEMBERS',
    'FILE_IN_SHARED_FOLDER',
    'FOLDER_TEST_FAILED',
    'FOLDER_IN_USE',
    'INVITATION_GONE',
    'NOT_SHARED',
    'ALREADY_MEMBER',
    'NOT_MEMBER',
    'SAME_KEY',
    'SAVE_FAILED',
    'TITLE_REQUIRED',
    'DISCUSSION_OPEN',
    'SYNCED_IMPORT',
    'ATTACHMENT_NOT_FOUND',
    'ATTACHMENT_MISSING',
    'ATTACHMENT_SAVE_FAILED',
    'ATTACHMENT_OPEN_FAILED'
] as const
export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

export class AppError extends CodedError<AppErrorCode> {
    constructor(code: AppErrorCode, message: string) {
        super(code, message, 'AppError')
    }
}
