/** Deterministic local image conversion fixture for the keyless ACP replay. */

import type { Context } from '@voyaseek-ai/cordis'
import DocumentConverter from '@voyaseek-ai/dsh-document-converter'
import type {
  DocumentConversionInput, DocumentConversionResult,
} from '@voyaseek-ai/dsh-document-converter'

/** Keyless converter whose output pins automatic text-route image fallback. */
export default class SnapshotDocumentConverter extends DocumentConverter {
  constructor(ctx: Context) {
    super(ctx)
  }

  /**
   * @param inputs - snapshot images in presentation order.
   * @returns deterministic Markdown for each fixture image.
   */
  convert(inputs: readonly DocumentConversionInput[]): Promise<DocumentConversionResult> {
    return Promise.resolve({
      provider: 'snapshot-local',
      engine: 'fixture-v1',
      documents: inputs.map(input => ({ name: input.name, markdown: 'One red pixel.' })),
    })
  }
}
