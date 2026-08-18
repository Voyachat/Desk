import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import { ocr } from 'mac-ocr'
import MacOcrDocumentConverter from '../src/index.ts'

vi.mock('mac-ocr', () => ({
  ocr: Object.assign(vi.fn(), { pages: vi.fn() }),
}))

const pages = vi.mocked(ocr.pages)

beforeEach(() => {
  pages.mockReset()
})

describe('macOS Vision document converter', () => {
  it('converts multiple inputs and PDF pages to bounded Markdown in input order', async () => {
    pages
      .mockImplementationOnce(async function* () {
        yield { text: 'first image', page: 1, pageCount: 1, width: 1, height: 1, observations: [] }
      })
      .mockImplementationOnce(async function* () {
        yield { text: 'page one', page: 1, pageCount: 2, width: 1, height: 1, observations: [] }
        yield { text: 'page two', page: 2, pageCount: 2, width: 1, height: 1, observations: [] }
      })
    const ctx = new Context()
    await ctx.plugin(MacOcrDocumentConverter, {
      languages: ['zh-Hans', 'en-US'],
      fast: false,
      maxOutputBytes: 4096,
      timeoutMs: 1000,
    })

    const result = await ctx.documentConverter.convert([
      { name: 'one.png', mediaType: 'image/png', data: Uint8Array.of(1) },
      { name: 'two.pdf', mediaType: 'application/pdf', data: Uint8Array.of(2) },
    ])

    expect(result).toEqual({
      provider: 'mac-ocr-local',
      engine: 'mac-ocr@1.1.1',
      documents: [
        { name: 'one.png', markdown: 'first image' },
        { name: 'two.pdf', markdown: 'page one\n\npage two' },
      ],
    })
    expect(pages).toHaveBeenCalledTimes(2)
    expect(pages.mock.calls[0]?.[1]).toMatchObject({ languages: ['zh-Hans', 'en-US'], fast: false })
    await ctx.fiber.dispose()
  })
})
