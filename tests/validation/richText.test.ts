import { describe, expect, it } from 'vitest'
import {
  checkDiscussionIntegrity,
  collectImageAssetIds,
  richDocSchema,
  richTextToPlain
} from '@shared/validation'
import { buildSample, para, richDoc, simple, text } from '../helpers/fixtures'

describe('rich-text schema', () => {
  it('accepts every supported node and mark', () => {
    const doc = richDoc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Заголовок')] },
      para(
        text('жирный', [{ type: 'bold' }]),
        text(' курсив', [{ type: 'italic' }, { type: 'underline' }]),
        text(' ссылка', [{ type: 'link', attrs: { href: 'https://example.com/a?b=1' } }]),
        text(' цвет', [
          { type: 'textColor', attrs: { color: '#ff0000' } },
          { type: 'backgroundColor', attrs: { color: '#ffee00cc' } }
        ]),
        { type: 'hardBreak' }
      ),
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              para(text('a')),
              { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('b'))] }] }
            ]
          }
        ]
      },
      para({ type: 'image', attrs: { assetId: 'abc' } })
    )
    expect(richDocSchema.safeParse(doc).success).toBe(true)
  })

  it.each([
    ['unknown node type', { type: 'doc', content: [{ type: 'script', content: [] }] }],
    ['raw html field', { type: 'doc', content: [{ type: 'paragraph', html: '<b>x</b>' }] }],
    [
      'javascript link',
      richDoc(para(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])))
    ],
    [
      'file link',
      richDoc(para(text('x', [{ type: 'link', attrs: { href: 'file:///C:/Windows' } }])))
    ],
    [
      'css injection color',
      richDoc(para(text('x', [{ type: 'textColor', attrs: { color: 'red; background:url(x)' } }])))
    ],
    ['heading level 4', richDoc({ type: 'heading', attrs: { level: 4 as 1 }, content: [] })],
    ['unknown mark', richDoc(para(text('x', [{ type: 'strike' } as never])))],
    ['empty text node', richDoc(para({ type: 'text', text: '' }))]
  ])('rejects %s', (_name, value) => {
    expect(richDocSchema.safeParse(value).success).toBe(false)
  })

  it('allows mailto and http links', () => {
    const ok = (href: string): boolean =>
      richDocSchema.safeParse(richDoc(para(text('x', [{ type: 'link', attrs: { href } }])))).success
    expect(ok('mailto:a@b.ru')).toBe(true)
    expect(ok('http://example.com')).toBe(true)
    expect(ok('ftp://example.com')).toBe(false)
  })

  it('extracts plain text and image ids', () => {
    const doc = richDoc(
      para(text('Привет ёж')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('пункт'))] }] },
      para({ type: 'image', attrs: { assetId: 'a1' } }, { type: 'image', attrs: { assetId: 'a1' } })
    )
    expect(richTextToPlain(doc)).toBe('Привет ёж\nпункт')
    expect(collectImageAssetIds(doc)).toEqual(['a1'])
  })
})

describe('discussion integrity', () => {
  it('accepts the sample discussion', () => {
    expect(checkDiscussionIntegrity(buildSample().contents.discussion)).toEqual([])
  })

  it('detects broken references and sequences', () => {
    const { contents, ids } = buildSample()
    const d = structuredClone(contents.discussion)
    const main = d.threads[0]!
    main.messages[1]!.sequence = 7
    main.messages[0]!.authorId = 'ghost'
    const branch = d.threads.find((t) => t.threadId === ids.branch1)!
    branch.sourceMessageId = 'nope'
    const problems = checkDiscussionIntegrity(d).join('\n')
    expect(problems).toMatch(/sequence 7/)
    expect(problems).toMatch(/unknown author/)
    expect(problems).toMatch(/source message not in parent/)
  })

  it('detects hierarchy cycles and a missing main thread', () => {
    const { contents, ids } = buildSample()
    const d = structuredClone(contents.discussion)
    d.threads[0]!.parentThreadId = ids.branch2
    expect(checkDiscussionIntegrity(d).join('\n')).toMatch(/main thread|cycle/)
  })

  it('requires images to be registered assets', () => {
    const { contents } = buildSample()
    const d = structuredClone(contents.discussion)
    d.threads[0]!.messages[0]!.content = richDoc(para({ type: 'image', attrs: { assetId: 'x' } }))
    expect(checkDiscussionIntegrity(d).join('\n')).toMatch(/not in assetReferences/)
    d.threads[0]!.messages[0]!.assetReferences = ['x']
    expect(checkDiscussionIntegrity(d).join('\n')).toMatch(/unknown asset/)
  })

  it('simple() helper builds valid content', () => {
    expect(richDocSchema.safeParse(simple('ok')).success).toBe(true)
  })
})
