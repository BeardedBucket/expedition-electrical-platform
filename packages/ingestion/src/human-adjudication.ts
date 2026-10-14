import type { CanonicalQualifiedValue, JsonValue, SourceRatingTarget } from './contracts.js';
import {
  artifactDigest,
  artifactReference,
  deterministicSerialize,
  type DocumentExtractionArtifact,
  type ProductIntake,
  type QualifiedFactArtifact,
} from './production-contracts.js';
import {
  normalizeProductionSemanticTarget,
  productionSemanticFieldDescriptor,
  productionSemanticValueMatchesTarget,
} from './field-mapping.js';
import { convertUnit, parseExactUnitValue, resolveUnit } from './units.js';
import { genericSemanticRules, type SourceRatingQualifiers } from './semantic-rules.js';
import { isCanonicalQualifiedValue, parseSourceObservations } from './qualified-values.js';
import { profileMemberValue, type ProfileQuantity } from './engineering-profile-adjudication.js';
import { readSourceOwnedSpecification } from './source-owned-specification.js';

export const HUMAN_ADJUDICATION_VERSION = 'human-adjudication.v1';
export interface HumanCitation {
  readonly document_id: string;
  readonly block_id: string;
  readonly cell_id?: string;
  /** Exact retained text, not a claim about PDF glyph coordinates. */
  readonly quote: string;
}
export type HumanMappingIntent =
  | {
      readonly kind: 'engineering_profile_fact';
      readonly target: 'engineering_profile';
      readonly quantity: ProfileQuantity;
    }
  | { readonly kind: 'scalar'; readonly target: string }
  | {
      readonly kind: 'source_rating';
      readonly target: SourceRatingTarget;
      readonly qualifiers: SourceRatingQualifiers;
    }
  | {
      readonly kind: 'source_observation';
      readonly target:
        'electrical.input_voltage_range_v' | 'electrical.power_consumption_w' | 'dimensions_mm';
    };
export interface HumanSourceStatement {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly wording: string;
  readonly citations: readonly HumanCitation[];
  readonly applicability: {
    readonly relationship:
      | 'statement'
      | 'text_heading'
      | 'table_column'
      | 'table_row'
      | 'shared_statement'
      | 'source_record'
      | 'unresolved';
    readonly citation?: HumanCitation;
  };
  readonly conditions?: readonly string[];
  readonly duration?: string;
  readonly temperature?: string;
  readonly revision?: string;
  readonly mapping?: HumanMappingIntent;
}
export interface HumanAdjudicationIntent {
  readonly version: typeof HUMAN_ADJUDICATION_VERSION;
  readonly group_id: string;
  readonly previous_event_id?: string;
  readonly replaces_fact_ids: readonly string[];
  readonly action: 'correct' | 'split' | 'add' | 'group' | 'incomplete';
  readonly disposition: 'ready' | 'draft';
  readonly statements: readonly HumanSourceStatement[];
  readonly rationale: string;
}
export interface HumanSourceProof {
  readonly version: typeof HUMAN_ADJUDICATION_VERSION;
  readonly event_id: string;
  readonly statement_index: number;
  readonly intake: ProductIntake;
  readonly statement: HumanSourceStatement;
  /** Detached retained artifacts make source replay possible after promotion. */
  readonly documents: readonly DocumentExtractionArtifact[];
}
export interface HumanAdjudicationEvent {
  readonly version: typeof HUMAN_ADJUDICATION_VERSION;
  readonly id: string;
  readonly actor: { readonly kind: 'operator_label'; readonly identifier: string };
  readonly recorded_at: string;
  readonly revision: number;
  readonly previous_digest?: string;
  readonly input_snapshot: string;
  readonly intent: HumanAdjudicationIntent;
  readonly original_fact_refs: readonly ReturnType<typeof artifactReference>[];
  readonly facts: readonly QualifiedFactArtifact[];
}
const equal = (a: unknown, b: unknown) => deterministicSerialize(a) === deterministicSerialize(b);
function fail(message: string): never {
  throw new Error(message);
}
const containsIdentity = (text: string, identity: string): boolean => {
  const escaped = identity.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
};
export function retainedCitation(
  citation: HumanCitation,
  documents: readonly DocumentExtractionArtifact[],
) {
  const document = documents.find((d) => d.id === citation.document_id);
  const block = document?.blocks.find((b) => b.id === citation.block_id);
  // Cell keys address existing retained row/column values; they create no new source coordinates.
  const cell = citation.cell_id
    ? block?.cells?.find((c) => `${c.row}:${c.column}` === citation.cell_id)
    : undefined;
  const text = citation.cell_id ? cell?.value : block?.content;
  if (
    !document ||
    !block ||
    text === undefined ||
    !citation.quote.trim() ||
    !text.includes(citation.quote)
  )
    return fail(
      'Manufacturer evidence is inadequate: the quote must occur exactly in a retained block or cell.',
    );
  return { document, block, cell, text };
}

// These are source-context signals, not an inference engine or a canonical
// definition. Unrecognized prose remains retained; uncertain ownership fails
// closed rather than letting a reviewer crop a favorable measurement.
const materialContext =
  /\b(?:minimum|maximum|min|max|peak|surge|nominal|rated|typical|idle|standby|sleep|no.load|rms|derat\w*|approximate\w*|at|with|when|under|for|if|only|using|measured|less than|greater than|revision)\b|[<>≤≥±]|°[CF]/i;
const measurement = /\d+(?:\.\d+)?\s*(?:mA|A|VDC|VAC|V|kW|W|kg|mm|cm)\b/g;

/** The server derives boundaries from retained structure, never a reviewer
 * selection. Complete sentences/lines/semicolon clauses may separate assertions.
 * An 'and' split is safe only without shared material qualifiers. Headings and
 * explicitly universal notes apply to their retained section; other qualifier
 * notes/competing table cells have uncertain ownership and cannot authorize maps.
 * This deliberately narrow policy can refuse prose requiring richer annotation. */
export function humanSourceContext(
  statement: HumanSourceStatement,
  documents: readonly DocumentExtractionArtifact[],
) {
  if (statement.applicability.relationship === 'source_record') {
    if (statement.citations.length !== 1)
      fail('A source record requires its complete single retained record');
    const citation = statement.citations[0];
    const row = readSourceOwnedSpecification(citation, documents);
    if (statement.wording !== row.statement || statement.value !== row.value)
      fail('Use the complete native label/value reconstruction; cropped values are refused');
    return {
      entries: [
        // The evidence citation addresses the complete encoded record. Decoded
        // context can contain JSON escapes and must not invent a substring locator.
        {
          citation,
          text: citation.quote,
          boundary: 'complete retained native label/value and containing context',
        },
      ],
      text: `${row.statement}\n${row.containing_context}`,
      uncertain: row.unresolved_context.length > 0,
    };
  }
  const entries: { citation: HumanCitation; text: string; boundary: string }[] = [];
  let uncertain = false;
  for (const citation of statement.citations) {
    const retained = retainedCitation(citation, documents);
    const { document, block, cell, text } = retained;
    if (!text.includes(statement.wording)) continue;
    const segments = text.split(/\n|;|(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.trim());
    if (
      (text.match(measurement)?.length ?? 0) > 1 &&
      segments.some((segment) => /^(?:at|under|with|when|for)\b/i.test(segment.trim()))
    )
      uncertain = true;
    const matches = segments.filter((s) => s.includes(statement.wording));
    let assertion = matches.length === 1 ? matches[0] : text;
    if (matches.length > 1) uncertain = true;
    if (!matches.length && segments.length > 1) uncertain = true;
    if ((assertion.match(measurement)?.length ?? 0) > 1 && /\band\b/i.test(assertion)) {
      if (materialContext.test(assertion)) uncertain = true;
      else {
        const clauses = assertion.split(/\band\b/i).filter((s) => s.includes(statement.wording));
        if (clauses.length === 1) assertion = clauses[0].trim();
      }
    }
    // A standalone following qualifier is context, not a second specification.
    const selected = segments.indexOf(matches[0]);
    const following = segments[selected + 1];
    if (selected >= 0 && following && /^(?:at|under|with|when|for)\b/i.test(following.trim()))
      assertion = text.slice(
        text.indexOf(assertion),
        text.indexOf(following, text.indexOf(assertion)) + following.length,
      );
    entries.push({ citation, text: assertion, boundary: 'retained assertion boundary' });
    for (const segment of segments) {
      if (segment === assertion || !materialContext.test(segment)) continue;
      const universal = segment.match(/\ball (?:ratings|specifications|measurements|values)\b/i);
      if (/^notes?\s*[:(]/i.test(segment.trim()) || universal) {
        if (!universal) uncertain = true;
        entries.push({
          citation,
          text: universal ? segment.slice(universal.index) : segment,
          boundary: 'retained same-block note',
        });
      }
    }
    const index = document.blocks.indexOf(block);
    const headings: (typeof document.blocks)[number][] = [];
    for (const previous of document.blocks.slice(0, index)) {
      if (previous.kind !== 'heading') continue;
      while (
        headings.length &&
        (headings.at(-1)!.heading_level ?? 1) >= (previous.heading_level ?? 1)
      )
        headings.pop();
      headings.push(previous);
    }
    const contextBlocks = document.blocks.filter((candidate, candidateIndex) => {
      if (headings.includes(candidate)) return true;
      if (candidate === block) return false;
      const start = headings.length ? document.blocks.indexOf(headings.at(-1)!) : 0;
      const next = document.blocks.slice(index + 1).find((b) => b.kind === 'heading');
      const end = next ? document.blocks.indexOf(next) : document.blocks.length;
      return (
        candidateIndex > start &&
        candidateIndex < end &&
        (candidate.kind === 'note' ||
          candidate.kind === 'table_caption' ||
          /(?:^notes?\s*[:(]|\ball (?:ratings|specifications|measurements|values)\b)/i.test(
            candidate.content ?? '',
          ))
      );
    });
    for (const contextBlock of contextBlocks) {
      const context = contextBlock.content ?? '';
      if (!materialContext.test(context)) continue;
      if (headings.includes(contextBlock) && block.locator.kind !== 'html') uncertain = true;
      if (
        !headings.includes(contextBlock) &&
        !/\ball (?:ratings|specifications|measurements|values)\b/i.test(context)
      )
        uncertain = true;
      entries.push({
        citation: { document_id: document.id, block_id: contextBlock.id, quote: context },
        text: context,
        boundary: 'retained section heading or note',
      });
    }
    if (statement.applicability.relationship === 'text_heading' && !headings.length) {
      const opening = text.split('\n')[0];
      if (materialContext.test(opening))
        entries.push({ citation, text: opening, boundary: 'retained opening heading' });
    }
    if (cell) {
      for (const other of block.cells ?? []) {
        if (other === cell) continue;
        if (other.kind !== 'header' || (other.column !== cell.column && other.row !== cell.row)) {
          if (materialContext.test(other.value)) uncertain = true;
        } else
          entries.push({
            citation: {
              document_id: document.id,
              block_id: block.id,
              cell_id: `${other.row}:${other.column}`,
              quote: other.value,
            },
            text: other.value,
            boundary: 'retained table header',
          });
      }
    }
  }
  if (!entries.length) fail('No retained assertion boundary contains the original wording.');
  return { entries, text: entries.map((e) => e.text).join('\n'), uncertain };
}

function requireCompleteMappingContext(
  statement: HumanSourceStatement,
  context: ReturnType<typeof humanSourceContext>,
) {
  if (!statement.mapping) return;
  if (context.uncertain)
    fail('Source qualifier ownership is uncertain; retain an unresolved assessment or draft.');
  if (statement.mapping.kind === 'scalar') {
    const axis = statement.mapping.target.match(/^dimensions_mm\.([xyz])$/)?.[1];
    if (
      axis &&
      !new RegExp(`\\b${axis}\\s*(?:axis|coordinate)\\b|\\b${axis}\\s*[:=]`, 'i').test(context.text)
    )
      fail('A scalar body coordinate requires an explicitly established source axis.');
    const intrinsic = statement.mapping.target.includes('nominal_voltage')
      ? context.text.replace(/\bnominal\b/gi, '')
      : context.text;
    if (materialContext.test(intrinsic))
      fail(
        'Material containing-source context requires a qualified representation; cropping the quote cannot remove it.',
      );
    // Even unfamiliar trailing prose cannot become unconditional by cropping.
    // This is a conservative scalar boundary, not a claim to understand prose.
    const escaped = statement.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrence = new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).exec(context.entries[0].text);
    if (!occurrence) fail('The complete source value must match a retained numeric boundary.');
    let tail = context.entries[0].text.slice(occurrence.index + statement.value.length).trim();
    if (statement.unit && tail.startsWith(statement.unit))
      tail = tail.slice(statement.unit.length).trim();
    if (tail.replace(/[.!]$/, '').trim())
      fail(
        'Additional containing-source prose needs a qualified representation or unresolved assessment.',
      );
  }
  if (statement.mapping.kind === 'source_rating') {
    for (const temperature of context.text.match(/-?\d+(?:\.\d+)?\s*°[CF]/g) ?? [])
      if (!statement.temperature?.includes(temperature))
        fail('Retain every applicable source temperature in the qualified interpretation.');
    for (const duration of context.text.match(
      /\b\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|ms)\b/gi,
    ) ?? [])
      if (!statement.duration?.includes(duration))
        fail('Retain every applicable source duration in the qualified interpretation.');
    const comparison = context.text.match(/(?:<=|>=|≤|≥|<|>)\s*\d+(?:\.\d+)?/)?.[0];
    if (comparison && !statement.value.includes(comparison))
      fail('Retain the containing source comparison in the source value.');
  }
}

/** Applicability is a source relationship, never a reviewer checkbox. Text-only
 * pages cannot prove ambiguous multi-column ownership. Text-only headings must
 * open their block; structured HTML uses retained section ownership. A later
 * section heading ends either relationship. */
export function validateHumanSourceStatement(
  statement: HumanSourceStatement,
  intake: ProductIntake,
  documents: readonly DocumentExtractionArtifact[],
): void {
  if (!statement.label.trim() || !statement.value.trim() || !statement.wording.trim())
    fail('Provide a source label, value and original wording.');
  if (!statement.citations.length) fail('Manufacturer evidence is missing.');
  const citations = statement.citations.map((c) => retainedCitation(c, documents));
  const capture = citations[0].document.source_capture.digest;
  if (citations.some((c) => c.document.source_capture.digest !== capture))
    fail('One assertion cannot combine different source captures.');
  const context = humanSourceContext(statement, documents);
  requireCompleteMappingContext(statement, context);
  const quoted = statement.citations.map((c) => c.quote).join('\n');
  if (!quoted.includes(statement.wording) || !statement.wording.includes(statement.value))
    fail('Original wording and the complete source value must be present in the cited text.');
  const valueText = statement.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`(?<![\\d.])${valueText}(?![\\d.])`).test(statement.wording))
    fail('The complete source value must match a retained numeric boundary.');
  if (statement.unit && !containsIdentity(context.text, statement.unit))
    fail('The declared source unit must be explicit in the cited evidence.');
  for (const declared of [
    ...(statement.conditions ?? []),
    statement.duration,
    statement.temperature,
    statement.revision,
  ].filter((v): v is string => v !== undefined))
    if (!declared.trim() || !context.text.includes(declared))
      fail('Operating context must be quoted from retained source evidence.');
  const scope = statement.applicability;
  if (!scope.citation || scope.relationship === 'unresolved')
    fail('Exact model applicability is incomplete; retain this correction as a draft.');
  const model = retainedCitation(scope.citation, documents);
  if (model.document.source_capture.digest !== capture)
    fail('Model scope must belong to the same source capture.');
  const identities = [intake.product_model, intake.manufacturer_part_number].filter(
    (v): v is string => !!v,
  );
  if (!identities.some((id) => containsIdentity(scope.citation!.quote, id)))
    fail('Model evidence does not name the requested product; sibling borrowing is refused.');
  if (scope.relationship === 'source_record') {
    const row = readSourceOwnedSpecification(scope.citation, documents);
    if (
      !identities.includes(row.identity) ||
      scope.citation.document_id !== statement.citations[0].document_id ||
      scope.citation.block_id !== statement.citations[0].block_id ||
      scope.citation.quote !== statement.citations[0].quote
    )
      fail('Source-owned row identity does not exactly match this intake and statement');
    // Native ownership retains the entire context but does not interpret it.
    // Scalar/rating projection cannot discard neighboring conditional source text.
    if (statement.mapping && statement.mapping.kind !== 'engineering_profile_fact')
      fail('Source-record meaning currently requires a context-retaining engineering profile');
  } else if (scope.relationship === 'table_column') {
    if (
      !model.cell ||
      model.cell.kind !== 'header' ||
      citations.some(
        (c) =>
          !c.cell ||
          c.block.id !== model.block.id ||
          c.cell.column !== model.cell!.column ||
          c.cell.row <= model.cell!.row,
      )
    )
      fail(
        'Exact column applicability requires a retained model header and statement cells in that same column.',
      );
  } else if (scope.relationship === 'table_row') {
    if (
      !model.cell ||
      !citations.some(
        (c) =>
          c.cell &&
          c.cell.row === model.cell!.row &&
          c.block.id === model.block.id &&
          c.cell.value.includes(statement.value),
      ) ||
      citations.some(
        (c) =>
          !c.cell ||
          c.block.id !== model.block.id ||
          (c.cell.row !== model.cell!.row && c.cell.kind !== 'header'),
      )
    )
      fail(
        'Exact row applicability requires a retained model cell and specification in that same row.',
      );
  } else if (scope.relationship === 'text_heading') {
    // HTML extraction already records section ownership and ordered headings.
    // Use that retained relationship without inventing a text span or borrowing
    // a heading across a subsequent section. Text-only PDF pages use the more
    // conservative same-block rule below and never gain table-column ownership.
    if (
      model.block.kind === 'heading' &&
      model.block.locator.kind === 'html' &&
      model.block.content === scope.citation.quote
    ) {
      const headingIndex = model.document.blocks.indexOf(model.block);
      if (
        /[,|/]|\b(?:models|variants)\b/i.test(scope.citation.quote) ||
        citations.some(
          (c) =>
            c.document.id !== model.document.id ||
            c.block.kind === 'table' ||
            c.cell ||
            c.block.locator.kind !== 'html' ||
            c.block.locator.section !== scope.citation!.quote ||
            model.document.blocks.indexOf(c.block) <= headingIndex ||
            model.document.blocks
              .slice(headingIndex + 1, model.document.blocks.indexOf(c.block))
              .some((b) => b.kind === 'heading'),
        )
      )
        fail('The retained exact-model heading does not own these source statements.');
      return;
    }
    if (
      citations.some((c) => c.block.id !== model.block.id) ||
      !model.text.startsWith(scope.citation.quote)
    )
      fail('Text heading must begin the retained statement block.');
    const firstLine = scope.citation.quote.split('\n')[0];
    if (!identities.some((id) => containsIdentity(firstLine, id)))
      fail('The opening heading must name the exact requested model.');
    if (/[,|/]|\b(?:models|variants)\b/i.test(firstLine))
      fail('A multiple-model heading does not establish exact statement ownership.');
    const statementStart = model.text.indexOf(statement.wording);
    const between = model.text.slice(firstLine.length, statementStart);
    if (
      statementStart < firstLine.length ||
      /\n[A-Z][A-Z &/\d-]{4,}\n/.test(between) ||
      /(?:models?|variants?)\s*[:|]/i.test(between)
    )
      fail(
        'Another section or ambiguous model table intervenes; cite a reliable source relationship.',
      );
  } else if (scope.relationship === 'shared_statement') {
    if (
      !/\b(?:all|both|each)\b/i.test(scope.citation.quote) ||
      !scope.citation.quote.includes(statement.wording)
    )
      fail(
        'Shared applicability needs an explicit shared statement naming the requested model and this specification.',
      );
  } else if (
    model.block.kind === 'table' ||
    !scope.citation.quote
      .split('\n')
      .some(
        (line) =>
          line.includes(statement.wording) && identities.some((id) => containsIdentity(line, id)),
      )
  )
    fail(
      'Exact applicability must be explicit on the same retained manufacturer statement, not an ambiguous table or neighboring line.',
    );
}

export function humanStatementFact(proof: HumanSourceProof): QualifiedFactArtifact {
  if (
    proof.version !== HUMAN_ADJUDICATION_VERSION ||
    !proof.event_id.trim() ||
    !Number.isSafeInteger(proof.statement_index) ||
    proof.statement_index < 0
  )
    fail('Human source proof has an unsupported version or invalid event identity.');
  validateHumanSourceStatement(proof.statement, proof.intake, proof.documents);
  const s = proof.statement;
  const context = humanSourceContext(s, proof.documents);
  const conditions = [
    ...new Set([
      ...(s.conditions ?? []),
      ...context.entries
        .filter((e) => e.text !== s.wording && materialContext.test(e.text))
        .map((e) => e.text),
    ]),
  ];
  const d = retainedCitation(s.citations[0], proof.documents).document;
  return {
    schema_version: '1.0',
    artifact_kind: 'qualified_fact',
    id: `human-qualified-fact.${artifactDigest({ event: proof.event_id, index: proof.statement_index, statement: s }).slice(7, 31)}`,
    source_capture: d.source_capture,
    source_acquisition: d.source_acquisition,
    document_extraction: artifactReference('document_extraction', d, d.id, d.schema_version),
    ...(d.acquisition_candidate_id ? { acquisition_candidate_id: d.acquisition_candidate_id } : {}),
    metadata: {
      source_label: s.label,
      raw_value: s.value,
      ...(s.unit ? { source_unit: s.unit } : {}),
      source_wording: s.wording,
      applicability: {
        kind: 'exact_product',
        value: proof.intake.product_model,
        reason: `Evidence-bound human ${s.applicability.relationship} adjudication`,
      },
      ...(conditions.length ? { conditions } : {}),
      ...(s.duration ? { duration: s.duration } : {}),
      ...(s.temperature ? { temperature_context: s.temperature } : {}),
      ...(s.revision ? { revision_context: s.revision } : {}),
    },
    evidence: [
      ...s.citations.map((c) => ({
        citation: c,
        role: 'value' as const,
        note: undefined,
      })),
      ...context.entries
        .filter(
          (e) =>
            !s.citations.some(
              (c) =>
                c.document_id === e.citation.document_id &&
                c.block_id === e.citation.block_id &&
                c.cell_id === e.citation.cell_id &&
                c.quote === e.text,
            ),
        )
        .map((e) => ({
          citation: { ...e.citation, quote: e.text },
          role: 'context' as const,
          note: e.boundary,
        })),
    ].map(({ citation: c, role, note }) => {
      const cited = retainedCitation(c, proof.documents);
      return {
        role,
        ...(note ? { note } : {}),
        text: c.quote,
        block_id: c.block_id,
        ...(c.cell_id ? { cell_id: c.cell_id } : {}),
        locator: cited.cell?.source_location ?? cited.block.locator,
        source_reference: artifactReference(
          'document_extraction',
          cited.document,
          cited.document.id,
          cited.document.schema_version,
        ),
      };
    }),
    qualifier: 'human_source_adjudication',
    qualifier_version: HUMAN_ADJUDICATION_VERSION,
    qualification_state: 'exact',
    human_source: proof,
  };
}
export interface HumanMappingPreview {
  readonly target: string;
  readonly normalized_value: JsonValue;
  readonly normalized_unit: string;
  readonly qualified_value?: CanonicalQualifiedValue;
}
/** Typed intent chooses meaning; the source owns values and the server owns
 * conversion and IDs. Source-rating wording is retained as a condition so a
 * manual interpretation cannot quietly erase an unmodeled material qualifier. */
export function previewHumanMapping(
  fact: QualifiedFactArtifact,
  intent: HumanMappingIntent,
): HumanMappingPreview {
  if (!fact.human_source || !equal(humanStatementFact(fact.human_source), fact))
    fail('Human source proof does not reconstruct the retained assertion.');
  const statement = fact.human_source.statement;
  if (!equal(statement.mapping, intent))
    fail('Mapping intent differs from the evidence-bound human statement.');
  const context = humanSourceContext(statement, fact.human_source.documents);
  requireCompleteMappingContext(statement, context);
  const s = {
    ...statement,
    wording: context.text,
    citations: [
      ...statement.citations,
      ...context.entries.map((e) => ({ ...e.citation, quote: e.text })),
    ],
  };
  const target = intent.target;
  if (intent.kind === 'engineering_profile_fact')
    return {
      target,
      normalized_value: profileMemberValue(
        intent.quantity,
        s.value,
        s.unit,
        s.wording,
        statement.applicability.relationship === 'source_record'
          ? readSourceOwnedSpecification(statement.citations[0], fact.human_source.documents).label
          : undefined,
      ),
      normalized_unit: 'structured',
    };
  // A manual label can repair parser terminology, but it cannot establish a
  // different physical quantity or rating basis merely because units match.
  if (/nominal_voltage/.test(target) && !/\bnominal\b/i.test(s.wording))
    fail('A nominal voltage needs explicitly nominal source evidence.');
  if (/efficiency/.test(target) && !/\befficien(?:cy|t)\b/i.test(s.wording))
    fail('Measurement precision cannot become efficiency.');
  if (
    /charge_current/.test(target) &&
    !/\b(?:charge|charging|discharge|discharging)\b/i.test(s.wording)
  )
    fail('Source evidence must establish charge or discharge current meaning.');
  if (/discharge_current/.test(target) && !/\bdischarg(?:e|ing)\b/i.test(s.wording))
    fail('A discharge rating requires discharge source meaning.');
  if (target === 'electrical.input_voltage_range_v' && !/\b(?:input|supply)\b/i.test(s.wording))
    fail('The source must establish the input or supply voltage range.');
  if (/dimensions_mm(?:\.[xyz])?$/.test(target)) {
    if (
      !/\b(?:body|outer|physical)\b/i.test(s.wording) ||
      /\b(?:installation|clearance|envelope|cut.out|bezel)\b/i.test(s.wording)
    )
      fail(
        'Body dimensions must be explicitly distinguished from installation or accessory dimensions.',
      );
    const axis = target.match(/\.([xyz])$/)?.[1];
    // Multiplication 'x' in a dimension triple is not an asserted X axis.
    if (
      axis &&
      !new RegExp(`\\b${axis}\\s*(?:axis|coordinate)\\b|\\b${axis}\\s*[:=]`, 'i').test(s.wording)
    )
      fail('A scalar body coordinate requires an explicitly established source axis.');
    if (
      target === 'dimensions_mm' &&
      !/\bh(?:eight)?\s*[x×/]\s*w(?:idth)?\s*[x×/]\s*d(?:epth)?\b/i.test(
        s.citations.map((c) => c.quote).join('\n'),
      )
    )
      fail(
        'The governed body-dimension parser requires explicit H × W × D source order; unknown order remains unresolved.',
      );
  }
  if (intent.kind === 'scalar') {
    // Unit compatibility alone cannot turn output evidence into an input rating.
    for (const direction of ['input', 'output'] as const)
      if (target.includes(`_${direction}_`) || target.includes(`.${direction}_`)) {
        const meaning = direction === 'input' ? /\b(?:input|supply)\b/i : /\boutput\b/i;
        if (!meaning.test(s.wording))
          fail('Source direction is not established for the selected direct property.');
      }
    if (target.includes('continuous') && !/\bcontinuous(?:ly)?\b/i.test(s.wording))
      fail('A direct continuous rating needs explicit continuous source meaning.');
    if (target.includes('peak') && !/\b(?:peak|surge)\b/i.test(s.wording))
      fail('A peak property cannot represent an ordinary or continuous rating.');
    if (
      ![
        'dimensions_mm',
        'electrical.input_voltage_range_v',
        'electrical.output_voltage_range_v',
      ].includes(target) &&
      (s.wording.match(/\d+(?:\.\d+)?\s*(?:mA|A|VDC|VAC|V|kW|W|kg|mm|cm)\b/g)?.length ?? 0) > 1
    )
      fail(
        'This wording combines multiple measurements; split the source assertion before scalar mapping.',
      );
    if (
      s.conditions?.length ||
      s.duration ||
      s.temperature ||
      s.revision ||
      // Editable labels cannot remove material context from manufacturer wording.
      /\b(?:maximum|peak|surge|idle|standby|no.load|with|when|at|for|less than|greater than)\b|[<>±]/i.test(
        s.wording,
      )
    )
      fail('Material source context requires a qualified representation.');
    const descriptor = productionSemanticFieldDescriptor(target);
    const value =
      descriptor && normalizeProductionSemanticTarget(target, s.value, s.unit, undefined, s.label);
    if (
      !descriptor ||
      !value ||
      value.qualifiers ||
      !productionSemanticValueMatchesTarget(target, value.value)
    )
      fail('This source value has no valid scalar representation for the selected property.');
    return { target, normalized_value: value.value, normalized_unit: descriptor.unit };
  }
  let qualified: unknown;
  let unit: string;
  if (intent.kind === 'source_observation') {
    if (target === 'electrical.power_consumption_w') {
      const condition = s.wording.match(/\b(?:at|with|when|for)\b.+/i)?.[0];
      if (
        /\b(?:maximum|typical|rms)\b|°[CF]/i.test(s.wording) ||
        (condition && !s.value.includes(condition))
      )
        fail(
          'Operating consumption must retain its complete supported measurement conditions; this context cannot be discarded.',
        );
      for (const state of s.wording.match(
        /\b(?:standby|idle|no.load|sleep|display|back.?light|AC|DC)\b/gi,
      ) ?? [])
        if (!`${s.label} ${s.value}`.toLowerCase().includes(state.toLowerCase()))
          fail(
            'Retain the source operating state and electrical domain in the governed observation.',
          );
    }
    if (
      /\b(?:at|with|when|for|idle|standby|sleep|maximum|typical|nominal|rated|approximate|approximately|derated|derating|rms)\b|[<>±]|°[CF]/i.test(
        s.wording,
      ) &&
      target !== 'electrical.power_consumption_w'
    )
      fail(
        'This observation has material operating context that its selected contract cannot retain.',
      );
    const values = parseSourceObservations(target, s.label, s.value, s.unit);
    if (
      !values ||
      values.length !== 1 ||
      !values[0].qualifiers ||
      s.conditions?.length ||
      s.duration ||
      s.temperature ||
      s.revision
    )
      fail('Source conditions cannot be represented by this governed observation contract.');
    qualified = { target, value: values[0].value, qualifiers: values[0].qualifiers };
    unit = target === 'dimensions_mm' ? 'mm' : target.endsWith('_w') ? 'W' : 'V';
  } else {
    const rule = genericSemanticRules.find((r) => r.target === target);
    const comparisonToken = s.value.trim().match(/^(<=|>=|≤|≥|<|>)\s*/)?.[1];
    const sourceNumber = s.value.trim().replace(/^(?:<=|>=|≤|≥|<|>)\s*/, '');
    const range = sourceNumber.match(/^([\d.]+)\s*(?:-|–|—|to)\s*([\d.]+)\s*(.*)$/i);
    const parsed = parseExactUnitValue(range ? `${range[1]} ${range[3]}` : sourceNumber, s.unit);
    const upper = range ? parseExactUnitValue(`${range[2]} ${range[3]}`, s.unit) : undefined;
    if (!rule || !parsed || resolveUnit(rule.unit)?.dimension !== parsed.unit.dimension)
      fail('Source units are incompatible with this governed rating.');
    const q = intent.qualifiers;
    const comparisons: Record<string, string> = {
      '<': 'less_than',
      '<=': 'less_than_or_equal',
      '≤': 'less_than_or_equal',
      '>': 'greater_than',
      '>=': 'greater_than_or_equal',
      '≥': 'greater_than_or_equal',
    };
    if ((comparisonToken ? comparisons[comparisonToken] : undefined) !== q.comparison)
      fail('Preserve the exact source comparison boundary.');
    if (
      range &&
      (!upper ||
        upper.unit.dimension !== parsed.unit.dimension ||
        upper.value < parsed.value ||
        comparisonToken)
    )
      fail('A qualified range needs compatible ordered bounds and no scalar comparison.');
    const basis = s.wording
      .match(/\b(maximum|continuous|nominal|peak|surge)\b/i)?.[1]
      .toLowerCase();
    if (
      basis &&
      q.rating_basis !== basis &&
      !(basis === 'maximum' && q.rating_basis === 'rated_maximum')
    )
      fail('Retain the explicitly stated rating basis.');
    if (/[<>≤≥]/.test(s.value) && !q.comparison)
      fail('Retain the source comparison boundary in a qualified representation.');
    if (
      /\bfor\s+\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|ms|s)\b/i.test(s.wording) &&
      !s.duration
    )
      fail('Source duration is missing from this qualified interpretation.');
    if (/\d\s*°[CF]/i.test(s.wording) && !s.temperature)
      fail('Source temperature context is missing from this qualified interpretation.');
    if (/\brms\b/i.test(s.wording) && q.measurement_basis !== 'rms')
      fail('Source RMS measurement basis must be retained.');
    if (
      (/\b(?:AC|VAC)\b/i.test(s.wording) && q.electrical_domain !== 'ac') ||
      (/\b(?:DC|VDC)\b/i.test(s.wording) && q.electrical_domain !== 'dc')
    )
      fail('Retain the explicitly stated electrical domain.');
    for (const key of ['duration', 'temperature_context', 'revision_context'] as const) {
      const required =
        key === 'duration'
          ? s.duration
          : key === 'temperature_context'
            ? s.temperature
            : s.revision;
      if (required !== q[key])
        fail(`The ${key.replace(/_/g, ' ')} must survive the engineering interpretation.`);
    }
    if (rule.direction && q.direction !== rule.direction)
      fail('Direction is incompatible with the selected property.');
    if (rule.required_domain && q.electrical_domain !== rule.required_domain)
      fail('Electrical domain is required for this property.');
    if (rule.required_role && q.product_role !== rule.required_role)
      fail('The source must explicitly establish the required product role.');
    if (
      q.product_role === 'battery' &&
      (!/\b(?:is (?:a )?battery|battery (?:pack|module|model))\b/i.test(
        s.applicability.citation?.quote ?? '',
      ) ||
        /\b(?:monitor|charger|controller)\b/i.test(
          (s.applicability.citation?.quote ?? '').split('\n')[0],
        ))
    )
      fail(
        'A battery reference or battery monitor does not establish that this product is a battery.',
      );
    const citationText = s.citations.map((c) => c.quote).join('\n');
    for (const [key, value] of Object.entries(q)) {
      if (key === 'source_conditions') {
        if (
          !Array.isArray(value) ||
          value.some((c) => typeof c !== 'string' || !citationText.includes(c))
        )
          fail('Conditions must be retained source quotations.');
      } else if (
        typeof value === 'string' &&
        !['duration', 'temperature_context', 'revision_context'].includes(key)
      ) {
        const words: Record<string, string> = {
          ac: 'AC',
          dc: 'DC',
          input: 'input|supply',
          output: 'output',
          rated_maximum: 'rated.*max',
          less_than: '<',
          less_than_or_equal: '<=|≤',
          greater_than: '>',
          greater_than_or_equal: '>=|≥',
        };
        if (!new RegExp(words[value] ?? value.replace(/_/g, '[ -]'), 'i').test(citationText))
          fail(`Source evidence does not establish ${key.replace(/_/g, ' ')}.`);
      } else if (typeof value === 'number' && !citationText.includes(String(value)))
        fail('A numeric qualifier must be explicit in the source.');
    }
    if (/\b(?:peak|surge)\b/i.test(s.wording) && !s.duration)
      fail(
        'A peak or surge rating needs its retained duration; unknown duration remains unresolved.',
      );
    qualified = {
      target,
      value: upper
        ? {
            min: convertUnit(parsed.value, parsed.unit.symbol, rule.unit),
            max: convertUnit(upper.value, upper.unit.symbol, rule.unit),
          }
        : convertUnit(parsed.value, parsed.unit.symbol, rule.unit),
      qualifiers: {
        ...q,
        kind: 'source_rating',
        source_conditions: [
          ...new Set([...(q.source_conditions ?? []), ...(s.conditions ?? []), s.wording]),
        ],
      },
    };
    unit = rule.unit;
  }
  const value = {
    ...(qualified as object),
    id: `qualified-value.${artifactDigest({ qualified, source_fact: fact.id }).slice(7, 31)}`,
  };
  if (!isCanonicalQualifiedValue(value))
    fail(
      'This qualified interpretation is not supported by the existing canonical engineering contract.',
    );
  return { target, normalized_value: value.value, normalized_unit: unit, qualified_value: value };
}

/** Drafts never suppress automatic facts or acquire engineering scope. Ready
 * events supersede only the explicitly bound source group, retaining every prior
 * event and original observation for audit. Genuine competing values stay in
 * ordinary reconciliation; grouping never chooses a winning value. */
export function replayHumanSourceFacts(
  original: readonly QualifiedFactArtifact[],
  events: readonly HumanAdjudicationEvent[],
): readonly QualifiedFactArtifact[] {
  const effective = new Map(original.map((f) => [f.id, f]));
  const previous = new Map<string, HumanAdjudicationEvent>();
  const ids = new Set<string>();
  for (const event of events) {
    const prior = previous.get(event.intent.group_id);
    if (
      event.version !== HUMAN_ADJUDICATION_VERSION ||
      event.intent.version !== HUMAN_ADJUDICATION_VERSION ||
      ids.has(event.id) ||
      event.revision !== (prior?.revision ?? 0) + 1 ||
      event.previous_digest !== (prior ? artifactDigest(prior) : undefined) ||
      event.intent.previous_event_id !== prior?.id ||
      !event.actor.identifier.trim() ||
      !event.intent.rationale.trim() ||
      !Number.isFinite(Date.parse(event.recorded_at))
    )
      fail('Human adjudication history has invalid identity, version or predecessor linkage.');
    ids.add(event.id);
    if (event.intent.disposition === 'ready') {
      if (!event.facts.length || event.facts.length !== event.intent.statements.length)
        fail('Ready adjudications must retain each source assertion.');
      event.facts.forEach((fact, index) => {
        if (
          !fact.human_source ||
          fact.human_source.event_id !== event.id ||
          fact.human_source.statement_index !== index ||
          !equal(fact.human_source.statement, event.intent.statements[index]) ||
          !equal(humanStatementFact(fact.human_source), fact)
        )
          fail('Human assertion cannot be replayed from its source proof.');
        if (fact.human_source.statement.mapping)
          previewHumanMapping(fact, fact.human_source.statement.mapping);
      });
      for (const id of event.intent.replaces_fact_ids) {
        const f = effective.get(id);
        if (
          !f ||
          !event.original_fact_refs.some(
            (r) => r.reference === id && r.digest === artifactDigest(f),
          )
        )
          fail('A correction must bind current original observations.');
        effective.delete(id);
      }
      // Revisions replace their earlier human assertions even when a draft was recorded in between.
      for (const [id] of effective)
        if (
          events.some(
            (e) =>
              e.intent.group_id === event.intent.group_id && e.facts.some((old) => old.id === id),
          )
        )
          effective.delete(id);
      event.facts.forEach((f) => effective.set(f.id, f));
    } else if (event.facts.length) fail('Draft adjudications cannot carry authoritative facts.');
    previous.set(event.intent.group_id, event);
  }
  return [...effective.values()].sort((a, b) => a.id.localeCompare(b.id));
}
