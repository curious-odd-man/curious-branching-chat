import { CodedError } from '../errors'

export const DOMAIN_ERROR_CODES = [
    'THREAD_NOT_FOUND',
    'MESSAGE_NOT_FOUND',
    'EMPTY_QUOTE',
    'EMPTY_MESSAGE',
    'UNKNOWN_ASSET',
    'MAIN_THREAD_NOT_CLOSABLE',
    'INVALID_SELECTION',
    'THREAD_CLOSED',
    'INVALID_REACTION',
    'TOO_MANY_ATTACHMENTS'
] as const
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

/** `message` is for the log; the user sees the text of `code` (`texts().errors`). */
export class DomainError extends CodedError<DomainErrorCode> {
    constructor(code: DomainErrorCode, message: string) {
        super(code, message, 'DomainError')
    }
}
