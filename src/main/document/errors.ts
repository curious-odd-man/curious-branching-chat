export type DocumentErrorCode =
    | 'NOT_FOUND'
    | 'ACCESS_DENIED'
    | 'NOT_AN_ARCHIVE'
    | 'UNSAFE_ENTRY'
    | 'DUPLICATE_ENTRY'
    | 'MISSING_ENTRY'
    | 'INVALID_JSON'
    | 'INVALID_SCHEMA'
    | 'INVALID_STRUCTURE'
    | 'UNSUPPORTED_VERSION'
    | 'UNSUPPORTED_IMAGE'
    | 'ASSET_MISMATCH'
    | 'WRITE_FAILED'

export class DocumentError extends Error {
    readonly code: DocumentErrorCode
    readonly details: string[]
    constructor(code: DocumentErrorCode, message: string, details: string[] = []) {
        super(message)
        this.name = 'DocumentError'
        this.code = code
        this.details = details
    }
}
