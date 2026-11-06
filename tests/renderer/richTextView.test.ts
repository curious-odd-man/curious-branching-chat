import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RichDoc } from '@shared/types'
import { RichTextView } from '../../src/renderer/components/rich/RichTextView'

const renderRaw = (doc: unknown, highlight?: { start: number; end: number }): string =>
  renderToStaticMarkup(
    createElement(RichTextView, {
      doc: doc as RichDoc,
      onOpenLink: () => undefined,
      highlight: highlight ?? null
    })
  )
/** The markup without the offset bookkeeping attributes (tested separately below). */
const render = (doc: unknown): string => renderRaw(doc).replace(/ data-o="\d+"/g, '')
const p = (...content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const doc = (...content: unknown[]) => ({ type: 'doc', content })

describe('RichTextView renders every supported feature', () => {
  it('headings, marks, lists and nested lists', () => {
    const html = render(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [t('Один')] },
        { type: 'heading', attrs: { level: 2 }, content: [t('Два')] },
        { type: 'heading', attrs: { level: 3 }, content: [t('Три')] },
        p(
          t('жирный', [{ type: 'bold' }]),
          t('курсив', [{ type: 'italic' }]),
          t('подчёркнутый', [{ type: 'underline' }]),
          t('цвет', [{ type: 'textColor', attrs: { color: '#d32f2f' } }]),
          t('фон', [{ type: 'backgroundColor', attrs: { color: '#fff59d' } }]),
          { type: 'hardBreak' }
        ),
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                p(t('a')),
                { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('b'))] }] }
              ]
            }
          ]
        }
      )
    )
    expect(html).toContain('<h1><span>Один</span></h1>')
    expect(html).toContain('<h2>')
    expect(html).toContain('<h3>')
    expect(html).toContain('<strong><span>жирный</span></strong>')
    expect(html).toContain('<em><span>курсив</span></em>')
    expect(html).toContain('<u><span>подчёркнутый</span></u>')
    expect(html).toContain('style="color:#d32f2f"')
    expect(html).toContain('style="background-color:#fff59d"')
    expect(html).toContain('<br/>')
    expect(html).toMatch(
      /<ul><li><p><span>a<\/span><\/p><ol><li><p><span>b<\/span><\/p><\/li><\/ol><\/li><\/ul>/
    )
  })

  it('links carry their address but are intercepted by the page', () => {
    const html = render(
      doc(p(t('сайт', [{ type: 'link', attrs: { href: 'https://example.com/a?b=1' } }])))
    )
    expect(html).toContain('href="https://example.com/a?b=1"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('title="Открыть: https://example.com/a?b=1"')
  })

  it('keeps Cyrillic, ё and emoji exactly', () => {
    expect(render(doc(p(t('Ёлка, ёж, 🌲 и 日本語'))))).toContain('Ёлка, ёж, 🌲 и 日本語')
  })

  it('renders an empty paragraph as a line break', () => {
    expect(render(doc({ type: 'paragraph' }))).toContain('<p><br/></p>')
  })
})

describe('RichTextView is inert (NFR-014)', () => {
  it('shows markup-looking text as text', () => {
    const attack =
      '<script>window.__xss=1</script><img src=x onerror="window.__xss=2"><b onmouseover=1>'
    const html = render(doc(p(t(attack))))
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__xss=2&quot;&gt;')
  })

  it('ignores a link with an unsafe protocol (text stays)', () => {
    for (const href of [
      'javascript:alert(1)',
      'file:///C:/Windows/System32/cmd.exe',
      'data:text/html,<script>1</script>',
      'ftp://x'
    ]) {
      const html = render(doc(p(t('клик', [{ type: 'link', attrs: { href } }]))))
      expect(html).not.toContain('<a')
      expect(html).not.toContain('href=')
      expect(html).toContain('клик')
    }
  })

  it('ignores non-plain colors (no CSS injection)', () => {
    const html = render(
      doc(
        p(
          t('x', [{ type: 'textColor', attrs: { color: 'red; background:url(https://evil/x)' } }]),
          t('y', [{ type: 'backgroundColor', attrs: { color: 'expression(alert(1))' } }])
        )
      )
    )
    expect(html).not.toContain('style=')
    expect(html).not.toContain('evil')
  })

  it('ignores unknown nodes and marks', () => {
    const html = render(
      doc(
        { type: 'script', content: [t('alert(1)')] },
        { type: 'iframe', attrs: { src: 'https://evil' } },
        p(t('ok', [{ type: 'strike' }, { type: 'bold' }]))
      )
    )
    expect(html).not.toContain('alert(1)')
    expect(html).not.toContain('iframe')
    expect(html).toContain('<strong><span>ok</span></strong>')
  })
})

describe('RichTextView offsets and the quoted passage (FR-054)', () => {
  const sample = doc(
    { type: 'heading', attrs: { level: 2 }, content: [t('Заголовок')] },
    p(t('жирный', [{ type: 'bold' }]), t(' и '), t('курсив', [{ type: 'italic' }]))
  ) // plain text: "Заголовок\nжирный и курсив"

  it('every piece of text carries its offset in the plain text', () => {
    const html = renderRaw(sample)
    expect(html).toContain('<span data-o="0">Заголовок</span>')
    expect(html).toContain('<strong><span data-o="10">жирный</span></strong>')
    expect(html).toContain('<span data-o="16"> и </span>')
    expect(html).toContain('<em><span data-o="19">курсив</span></em>')
  })

  it('marks the quoted passage across formatting boundaries, splitting text where needed', () => {
    // "рный и курс" = offsets 12..23
    const html = renderRaw(sample, { start: 12, end: 23 })
    expect(html).toContain('<span data-o="10">жи</span>')
    expect(html).toContain('<mark class="quote"><span data-o="12">рный</span></mark>')
    expect(html).toContain('<mark class="quote"><span data-o="16"> и </span></mark>')
    expect(html).toContain('<mark class="quote"><span data-o="19">курс</span></mark>')
    expect(html).toContain('<span data-o="23">ив</span>')
    const marked = [...html.matchAll(/<mark class="quote">.*?<\/mark>/g)].map((m) =>
      m[0].replace(/<[^>]+>/g, '')
    )
    expect(marked.join('')).toBe('рный и курс')
  })

  it('does not mark anything without a highlight or outside the text', () => {
    expect(renderRaw(sample)).not.toContain('<mark')
    expect(renderRaw(sample, { start: 100, end: 120 })).not.toContain('<mark')
  })

  it('keeps links clickable inside the highlight', () => {
    const html = renderRaw(
      doc(p(t('до '), t('сайт', [{ type: 'link', attrs: { href: 'https://example.com' } }]))),
      {
        start: 1,
        end: 5
      }
    )
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('<mark class="quote"><span data-o="3">са</span></mark>')
  })
})

describe('RichTextView images (FR-068, FR-075)', () => {
  const sha = 'ab'.repeat(32)
  const gone = 'cd'.repeat(32)
  const images = {
    url: (id: string) => `bcasset://asset/s1/${id}`,
    missing: new Set([gone]),
    onOpen: () => undefined,
    onLoad: () => undefined
  }
  const withImages = (d: unknown): string =>
    renderToStaticMarkup(
      createElement(RichTextView, { doc: d as RichDoc, onOpenLink: () => undefined, images })
    )
  const image = (assetId: string, alt?: string) => ({
    type: 'image',
    attrs: { assetId, ...(alt ? { alt } : {}) }
  })

  it('shows an image from the discussion address, inline with text', () => {
    const html = withImages(doc(p(t('до '), image(sha), t(' после'))))
    expect(html).toContain(`src="bcasset://asset/s1/${sha}"`)
    expect(html).toContain('data-testid="message-image"')
    expect(html).toContain('до ')
    expect(html).toContain(' после')
  })

  it('shows a placeholder for an image whose data is missing, and keeps the rest of the message', () => {
    const html = withImages(doc(p(t('текст'), image(gone))))
    expect(html).toContain('data-testid="image-placeholder"')
    expect(html).not.toContain('<img')
    expect(html).toContain('текст')
  })

  it('escapes the alternative text', () => {
    const html = withImages(doc(p(image(sha, '"><script>alert(1)</script>'))))
    expect(html).not.toContain('<script')
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('shows no images when none are provided (for example in a context that does not support them)', () => {
    expect(render(doc(p(t('a'), image(sha))))).not.toContain('<img')
  })

  it('images do not move the offsets of the text around them', () => {
    const html = renderRaw(doc(p(t('до '), image(sha), t(' после'))))
    expect(html).toContain('<span data-o="0">до </span>')
    expect(html).toContain('<span data-o="3"> после</span>')
  })
})
