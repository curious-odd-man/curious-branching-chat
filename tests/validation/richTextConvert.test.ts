import { describe, expect, it } from 'vitest'
import {
  isRichDocBlank,
  normalizeColor,
  richDocSchema,
  sanitizeEditorDoc
} from '@shared/validation'

describe('normalizeColor', () => {
  it('accepts hex and rgb, rejects everything else', () => {
    expect(normalizeColor('#FF0000')).toBe('#ff0000')
    expect(normalizeColor('#abc')).toBe('#abc')
    expect(normalizeColor('rgb(255, 0, 16)')).toBe('#ff0010')
    expect(normalizeColor('rgba(0,128,255,0.5)')).toBe('#0080ff')
    for (const bad of [
      'red',
      'rgb(300,0,0)',
      'red; background:url(x)',
      'url(javascript:1)',
      '',
      '#12',
      42,
      null
    ])
      expect(normalizeColor(bad)).toBeNull()
  })
})

describe('sanitizeEditorDoc', () => {
  const tiptap = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, textAlign: null },
        content: [{ type: 'text', text: 'Заголовок' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'жирный', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' курсив', marks: [{ type: 'italic' }, { type: 'underline' }] },
          {
            type: 'text',
            text: ' ссылка',
            marks: [
              {
                type: 'link',
                attrs: {
                  href: 'https://example.com',
                  target: '_blank',
                  rel: 'noopener',
                  class: null
                }
              }
            ]
          },
          {
            type: 'text',
            text: ' цвет',
            marks: [
              { type: 'textStyle', attrs: { color: 'rgb(255, 0, 0)', backgroundColor: '#FFEE00' } }
            ]
          },
          { type: 'hardBreak' }
        ]
      },
      {
        type: 'orderedList',
        attrs: { start: 1, type: null },
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'один' }] },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'вложенный' }] }]
                  }
                ]
              }
            ]
          }
        ]
      },
      { type: 'paragraph' },
      { type: 'paragraph' }
    ]
  }

  it('produces the strict stored format', () => {
    const doc = sanitizeEditorDoc(tiptap)
    expect(richDocSchema.safeParse(doc).success).toBe(true)
    expect(doc.content).toHaveLength(3) // trailing empty paragraphs removed
    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Заголовок' }]
    })
    const para = doc.content[1]
    expect(para).toMatchObject({ type: 'paragraph' })
    const nodes = (para as { content: unknown[] }).content
    expect(nodes[2]).toEqual({
      type: 'text',
      text: ' ссылка',
      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
    })
    expect(nodes[3]).toEqual({
      type: 'text',
      text: ' цвет',
      marks: [
        { type: 'textColor', attrs: { color: '#ff0000' } },
        { type: 'backgroundColor', attrs: { color: '#ffee00' } }
      ]
    })
    expect(doc.content[2]).toEqual({
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'один' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'вложенный' }] }]
                }
              ]
            }
          ]
        }
      ]
    })
  })

  it('drops disallowed links and colors but keeps the text', () => {
    const doc = sanitizeEditorDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]
            },
            {
              type: 'text',
              text: 'b',
              marks: [{ type: 'textStyle', attrs: { color: 'red; x:y' } }]
            }
          ]
        }
      ]
    })
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' }
      ]
    })
  })

  it.each([
    ['unknown node', { type: 'doc', content: [{ type: 'codeBlock', content: [] }] }],
    [
      'unknown mark',
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'strike' }] }] }
        ]
      }
    ],
    [
      'heading level 5',
      { type: 'doc', content: [{ type: 'heading', attrs: { level: 5 }, content: [] }] }
    ],
    ['not a doc', { type: 'paragraph' }],
    ['garbage', 'hello']
  ])('rejects %s', (_name, input) => {
    expect(() => sanitizeEditorDoc(input)).toThrow()
  })

  it('detects blank documents', () => {
    expect(
      isRichDocBlank(sanitizeEditorDoc({ type: 'doc', content: [{ type: 'paragraph' }] }))
    ).toBe(true)
    expect(
      isRichDocBlank({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }]
      })
    ).toBe(true)
    expect(
      isRichDocBlank({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }]
      })
    ).toBe(false)
    expect(
      isRichDocBlank({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { assetId: 'a' } }] }]
      })
    ).toBe(false)
  })
})
