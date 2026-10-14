import type { DocumentExtractionArtifact } from './production-contracts.js';
import type { HumanCitation } from './human-adjudication.js';

/** Private retained read-model of native label/value ownership. `statement` is
 * explicitly reconstructed from two source nodes, never a quoted prose sentence.
 * Full containing context travels with the row; byte/capture authenticity is
 * still owned by preparation and the durable job's original documents. */
export interface SourceOwnedSpecification {
  version: 'source-owned-specification.v1';
  label: string;
  value: string;
  statement: string;
  identity: string;
  identity_kind: 'exact_product' | 'exact_mpn_or_sku';
  label_locator: string;
  value_locator: string;
  value_byte_locator?: string;
  identity_locator: string;
  containing_context: string;
  unresolved_context: string[];
}

export function readSourceOwnedSpecification(
  citation: HumanCitation,
  documents: readonly DocumentExtractionArtifact[],
): SourceOwnedSpecification {
  const document = documents.find((d) => d.id === citation.document_id);
  const block = document?.blocks.find((b) => b.id === citation.block_id);
  if (
    !document ||
    !block ||
    citation.cell_id ||
    citation.quote !== block.content ||
    block.kind !== 'structured' ||
    document.status !== 'extracted' ||
    !['source-product-html:3.0.0', 'native-model-review:1.0.0'].includes(
      `${document.extractor}:${document.extractor_version}`,
    )
  )
    throw new Error('Choose the complete retained source-owned specification record');
  const raw: unknown = JSON.parse(block.content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid source row');
  const r = raw as SourceOwnedSpecification;
  if (
    r.version !== 'source-owned-specification.v1' ||
    Object.keys(r).some(
      (k) =>
        ![
          'version',
          'label',
          'value',
          'statement',
          'identity',
          'identity_kind',
          'label_locator',
          'value_locator',
          'value_byte_locator',
          'identity_locator',
          'containing_context',
          'unresolved_context',
        ].includes(k),
    ) ||
    !['exact_product', 'exact_mpn_or_sku'].includes(r.identity_kind) ||
    [
      'label',
      'value',
      'statement',
      'identity',
      'label_locator',
      'value_locator',
      'identity_locator',
      'containing_context',
    ].some(
      (key) =>
        typeof r[key as keyof SourceOwnedSpecification] !== 'string' ||
        !String(r[key as keyof SourceOwnedSpecification]).trim(),
    ) ||
    r.statement !== `${r.label} ${r.value}` ||
    !Array.isArray(r.unresolved_context) ||
    r.unresolved_context.some((v) => typeof v !== 'string' || !v.trim())
  )
    throw new Error('Source-owned row does not reconstruct its native label/value relationship');
  return r;
}
