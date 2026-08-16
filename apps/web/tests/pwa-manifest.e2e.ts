import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'Voyaseek',
    short_name: 'Voyaseek',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/voyaseek-mark.png',
      sizes: '256x256',
      type: 'image/png',
      purpose: 'any',
    }],
  })
})

it('ships the Voyaseek mark as a PNG favicon', async () => {
  const favicon = await readFile(join(DIST_ROOT, 'voyaseek-mark.png'))
  // PNG magic bytes: the shipped icon is a raster mark, not themed svg art.
  expect(favicon.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})
