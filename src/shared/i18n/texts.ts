import type { ru } from './ru'

/** A string literal type becomes `string`, so `en.ts` must have the same keys and signatures, not the same words. */
type Widen<T> = T extends string
    ? string
    : T extends (...args: infer A) => infer R
      ? (...args: A) => Widen<R>
      : T extends readonly (infer U)[]
        ? readonly Widen<U>[]
        : T extends object
          ? { readonly [K in keyof T]: Widen<T[K]> }
          : T

export type Texts = Widen<typeof ru>
