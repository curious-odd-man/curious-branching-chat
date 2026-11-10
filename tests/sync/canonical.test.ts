import { describe, expect, it } from 'vitest'
import { CanonicalJsonError, canonicalJson, isCanonicalJson } from '@shared/sync'

describe('canonical JSON (sync-protocol.md 2.2)', () => {
    it('sorts keys, removes white space, keeps array order (test vector 1)', () => {
        const value = { b: 1, a: [3, 1, 2], c: { z: 'ё', y: null, x: true } }
        expect(canonicalJson(value)).toBe('{"a":[3,1,2],"b":1,"c":{"x":true,"y":null,"z":"ё"}}')
    })

    it('sorts keys by UTF-16 code units (test vector 2)', () => {
        expect(canonicalJson({ b: 0, B: 0, a: 0, Ё: 0, é: 0 })).toBe(
            '{"B":0,"a":0,"b":0,"é":0,"Ё":0}'
        )
    })

    it('escapes strings like JSON.stringify (test vector 3)', () => {
        expect(canonicalJson({ s: 'a"b\\c\n\u0001😀' })).toBe('{"s":"a\\"b\\\\c\\n\\u0001😀"}')
    })

    it('refuses floats, negatives, unsafe integers, undefined, and non-plain objects', () => {
        for (const bad of [
            { n: 1.5 },
            { n: -1 },
            { n: 2 ** 53 },
            { n: Number.NaN },
            { u: undefined },
            [undefined],
            { d: new Date(0) },
            { f: () => 1 },
            { b: BigInt(1) }
        ])
            expect(() => canonicalJson(bad), JSON.stringify(String(bad))).toThrow(
                CanonicalJsonError
            )
    })

    it('recognizes canonical text and refuses other forms of the same value', () => {
        expect(isCanonicalJson('{"a":1,"b":[true]}')).toBe(true)
        expect(isCanonicalJson('{"b":[true],"a":1}')).toBe(false)
        expect(isCanonicalJson('{"a": 1}')).toBe(false)
        expect(isCanonicalJson('{"a":1,"a":1}')).toBe(false)
        expect(isCanonicalJson('{"a":1.0}')).toBe(false)
        expect(isCanonicalJson('not json')).toBe(false)
    })
})
