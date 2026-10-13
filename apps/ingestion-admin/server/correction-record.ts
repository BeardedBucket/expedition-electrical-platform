import {
  artifactDigest,
  validateHumanSourceStatement,
  humanSourceContext,
  parseExactUnitValue,
  type HumanCitation,
  type HumanSourceStatement,
  type QualifiedFactArtifact,
  type ReviewReadyProductionIngest,
} from '@expedition/ingestion';

/** A convenience seed, not eligibility. Only existing coordinates are reused;
 * every candidate source relationship passes the unchanged domain validator.
 * Failed/inexact source relationships stay unresolved for explicit source work. */
export function correctionRecord(
  fact: QualifiedFactArtifact,
  preparation: ReviewReadyProductionIngest,
) {
  if (fact.human_source)
    return {
      fact_id: fact.id,
      origin: 'human' as const,
      source_ready: true,
      statement: fact.human_source.statement,
      warning: undefined as string | undefined,
    };
  const value =
    typeof fact.metadata.raw_value === 'object' ? undefined : String(fact.metadata.raw_value);
  const documents = preparation.document_extractions.filter(
    (d) => d.source_capture.digest === fact.source_capture.digest,
  );
  let citation: HumanCitation | undefined;
  for (const evidence of fact.evidence ?? []) {
    if (evidence.role !== 'value') continue;
    for (const document of documents) {
      if (
        evidence.source_reference?.kind === 'document_extraction' &&
        evidence.source_reference.digest !== artifactDigest(document)
      )
        continue;
      for (const block of document.blocks) {
        const cell = block.cells?.find(
          (c) =>
            `${c.row}:${c.column}` === evidence.cell_id ||
            (evidence.locator &&
              artifactDigest(c.source_location) === artifactDigest(evidence.locator)),
        );
        const owned =
          cell ||
          block.id === evidence.block_id ||
          (evidence.locator && artifactDigest(block.locator) === artifactDigest(evidence.locator));
        const text = cell?.value ?? block.content;
        if (owned && value && text?.includes(value))
          citation = {
            document_id: document.id,
            block_id: block.id,
            ...(cell ? { cell_id: `${cell.row}:${cell.column}` } : {}),
            quote: text,
          };
      }
    }
  }
  const statement: HumanSourceStatement = {
    label: fact.metadata.source_label ?? '',
    value: value ?? '',
    ...(fact.metadata.source_unit ? { unit: fact.metadata.source_unit } : {}),
    wording: citation?.quote.includes(fact.metadata.source_wording)
      ? fact.metadata.source_wording
      : (citation?.quote ?? fact.metadata.source_wording),
    citations: citation ? [citation] : [],
    applicability: { relationship: 'unresolved' },
    ...(fact.metadata.conditions?.length ? { conditions: fact.metadata.conditions } : {}),
    ...(fact.metadata.duration ? { duration: fact.metadata.duration } : {}),
    ...(fact.metadata.temperature_context
      ? { temperature: fact.metadata.temperature_context }
      : {}),
    ...(fact.metadata.revision_context ? { revision: fact.metadata.revision_context } : {}),
  };
  if (citation && ['exact', 'structurally_supported'].includes(fact.qualification_state ?? '')) {
    const document = documents.find((d) => d.id === citation.document_id)!;
    const block = document.blocks.find((b) => b.id === citation.block_id)!;
    const candidates: HumanSourceStatement['applicability'][] = [
      { relationship: 'statement', citation },
      { relationship: 'shared_statement', citation },
      {
        relationship: 'text_heading',
        citation: { ...citation, quote: citation.quote.split('\n')[0] },
      },
    ];
    for (const cell of block.cells ?? [])
      for (const relationship of ['table_row', 'table_column'] as const)
        candidates.push({
          relationship,
          citation: {
            document_id: document.id,
            block_id: block.id,
            cell_id: `${cell.row}:${cell.column}`,
            quote: cell.value,
          },
        });
    for (const heading of document.blocks.filter((b) => b.kind === 'heading' && b.content))
      candidates.push({
        relationship: 'text_heading',
        citation: { document_id: document.id, block_id: heading.id, quote: heading.content! },
      });
    for (const applicability of candidates) {
      const proposed = { ...statement, applicability };
      try {
        validateHumanSourceStatement(proposed, preparation.intake, documents);
        const context = humanSourceContext(proposed, documents);
        const temperatures = [...new Set(context.text.match(/-?\d+(?:\.\d+)?\s*°[CF]/g) ?? [])];
        const durations = [
          ...new Set(
            context.text.match(/\b\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|ms|s)\b/gi) ?? [],
          ),
        ];
        // Literal, single-valued source context may prefill source fields; no
        // conversion, engineering meaning or uncertain qualifier ownership is inferred.
        // A missing automatic unit may be seeded only from a literal leading
        // quantity whose unit the existing parser recognizes. Preserve the
        // complete wording and all containing context; never infer from a target.
        const leading = proposed.value
          .trim()
          .match(/^((?:(?:<=|>=|<|>|≤|≥)\s*)?[+-]?\d+(?:\.\d+)?)\s+([A-Za-zµμΩ°²]+)(?=\s|$)/);
        const literalUnit =
          leading &&
          parseExactUnitValue(`${leading[1].replace(/^(?:<=|>=|<|>|≤|≥)\s*/, '')} ${leading[2]}`)
            ? leading[2]
            : undefined;
        const sourceUnit = proposed.unit ?? literalUnit;
        const unitLiteral = sourceUnit?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Separate only an explicit duration/temperature suffix. Ranges and
        // multiple quantities stay intact for explicit human reconstruction.
        const quantity =
          unitLiteral && !parseExactUnitValue(proposed.value, sourceUnit)
            ? proposed.value
                .trim()
                .match(
                  new RegExp(
                    `^((?:(?:<=|>=|<|>|≤|≥)\\s*)?[+-]?\\d+(?:\\.\\d+)?\\s*${unitLiteral})(?![a-z])(?=\\s+(?:for|at)\\b)`,
                    'i',
                  ),
                )?.[1]
            : undefined;
        const seed = {
          ...proposed,
          ...(!context.uncertain && !proposed.unit && literalUnit ? { unit: literalUnit } : {}),
          ...(quantity && !context.uncertain ? { value: quantity } : {}),
          ...(!context.uncertain && !proposed.temperature && temperatures.length === 1
            ? { temperature: temperatures[0] }
            : {}),
          ...(!context.uncertain && !proposed.duration && durations.length === 1
            ? { duration: durations[0] }
            : {}),
        };
        validateHumanSourceStatement(seed, preparation.intake, documents);
        return {
          fact_id: fact.id,
          origin: 'automatic' as const,
          source_ready: !context.uncertain,
          statement: seed,
          warning: context.uncertain
            ? 'Source qualifier ownership remains uncertain. Keep an unresolved draft or establish a reliable source boundary.'
            : (undefined as string | undefined),
        };
      } catch {
        /* No inferred authority from an unsuccessful seed. */
      }
    }
  }
  return {
    fact_id: fact.id,
    origin: 'automatic' as const,
    source_ready: false,
    statement,
    warning:
      'The retained statement or exact-model relationship needs source review before an engineering correction can be validated.',
  };
}
