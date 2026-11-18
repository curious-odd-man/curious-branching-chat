// relative path: e2e tests load this file without the @shared alias
import { CodedError } from '../../shared/errors'

export const DOCUMENT_ERROR_CODES = [
    'NOT_FOUND',
    'ACCESS_DENIED',
    'NOT_AN_ARCHIVE',
    'UNSAFE_ENTRY',
    'DUPLICATE_ENTRY',
    'MISSING_ENTRY',
    'INVALID_JSON',
    'INVALID_SCHEMA',
    'INVALID_STRUCTURE',
    'UNSUPPORTED_VERSION',
    'UNSUPPORTED_IMAGE',
    'ASSET_MISMATCH',
    'WRITE_FAILED'
] as const
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number]

export class DocumentError extends CodedError<DocumentErrorCode> {
    readonly details: string[]
    constructor(code: DocumentErrorCode, message: string, details: string[] = []) {
        super(code, message, 'DocumentError')
        this.details = details
    }
}
