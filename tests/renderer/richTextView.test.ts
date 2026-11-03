import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { RichDoc } from '@shared/types'
import { RichTextView } from '../../src/renderer/components/rich/RichTextView'

const render = (doc: unknown): string =>
  renderToStaticMarkup(
    createElement(RichTextView, { doc: doc as RichDoc, onOpenLink: () => undefined })
  )
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
    expect(html).toContain('<strong>жирный</strong>')
    expect(html).toContain('<em>курсив</em>')
    expect(html).toContain('<u>подчёркнутый</u>')
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
    expect(html).toContain('<strong>ok</strong>')
  })
})
