/**
 * The base of all errors that the user can see (DomainError, AppError, DocumentError, LibraryError). `code` selects
 * the text in `ru.ts` and `en.ts` (`texts().errors`); `message` is for the log only and is never shown.
 */
export class CodedError<C extends string = string> extends Error {
    readonly code: C
    constructor(code: C, message: string, name: string) {
        super(message)
        this.name = name
        this.code = code
    }
}
