import { createHash } from 'node:crypto';
import type { CapturedSource, ExtractedDocument, ExtractedBlock } from './capture-types.js';
import { buildProductCandidate } from './candidate-builder.js';
import { createProductSource } from './capture-types.js';
import { extractProductFacts } from './fact-extraction.js';
import { normalizeProductFact } from './normalize-fact.js';
import {
  validateProductCandidate,
  validateProductFacts,
  validateProductSources,
} from './validation.js';
import type { ProductCandidate, ProductFact, ProductIdentity, ProductSource } from './contracts.js';
import type { IngestionValidation } from './validation.js';
import type { NormalizedProductFact } from './normalization-types.js';

export const productUrl = 'https://www.victronenergy.com/inverters-chargers/multiplus-2000-va';
export const sku = 'PMP242200100';
export const sourceId = 'victron.multiplus-24-2000-50-50-120v.product-page';
export const candidateId = 'victron.multiplus-24-2000-50-50-120v.pmp242200100';

export const identity: ProductIdentity = {
  manufacturer: 'Victron Energy',
  product_family: 'MultiPlus',
  model: '24/2000/50-50 120V VE.Bus',
  manufacturer_part_number: sku,
  regional_variant: '120V',
  voltage_variant: '24V DC input',
  lifecycle_status: 'discontinued',
};

export const policyMetadata = {
  authority: 'manufacturer_product',
  lifecycle_status: 'discontinued',
  product_role: 'inverter_charger',
} as const;

const focusedLabels = new Set([
  'Nominal battery voltage',
  'AC output voltage ±2% (adjustable)',
  'AC output frequency ±0.1% (adjustable)',
  'Maximum charge current (up to 25°C ambient)',
  'Continuous inverter AC output power at 25°C',
  'Continuous power at 25°C (Nonlinear load, crest factor 3:1)',
  'Weight',
  'Height',
  'Width',
  'Depth',
]);

const unitByLabel = new Map<string, string>([
  ['Nominal battery voltage', 'V'],
  ['AC output voltage ±2% (adjustable)', 'VAC'],
  ['AC output frequency ±0.1% (adjustable)', 'Hz'],
  ['Maximum charge current (up to 25°C ambient)', 'A'],
  ['Continuous inverter AC output power at 25°C', 'W'],
  ['Continuous power at 25°C (Nonlinear load, crest factor 3:1)', 'VA'],
  ['Weight', 'kg'],
  ['Height', 'mm'],
  ['Width', 'mm'],
  ['Depth', 'mm'],
]);

export interface PilotReport {
  readonly identity: ProductIdentity;
  readonly product_role: string;
  readonly sources_used: readonly string[];
  readonly normalized_fields: readonly string[];
  readonly unresolved_or_unmapped_facts: readonly {
    readonly id: string;
    readonly label: string;
    readonly value: string;
  }[];
  readonly conflicts: readonly unknown[];
  readonly unsupported_source_media: readonly unknown[];
  readonly validation: IngestionValidation;
  readonly review_state: ProductCandidate['review_status'];
  readonly promotion_state: ProductCandidate['promotion_status'];
  readonly promotion_blocker: string;
}

export interface PilotArtifact {
  readonly schema_version: string;
  readonly captured_at: string;
  readonly pilot_target_identity: ProductIdentity;
  readonly source_identity_evidence: {
    readonly source_id: string;
    readonly manufacturer_part_number: string;
    readonly raw_value: string;
    readonly locator: { readonly fragment: string; readonly section: string };
    readonly extraction_method: 'structured';
    readonly provenance_type: 'source_observed';
  };
  readonly policy_metadata: typeof policyMetadata;
  readonly source: ProductSource;
  readonly facts: readonly ProductFact[];
  readonly candidate: ProductCandidate;
  readonly report: PilotReport;
}

export const extractSkuFeatures = (html: string): { label: string; value: string }[] => {
  const normalizedHtml = html.replace(/\\"/g, '"');
  const skuOffset = normalizedHtml.indexOf(`"sku":"${sku}"`);
  if (skuOffset < 0) throw new Error(`Official page did not contain SKU ${sku}.`);
  const nextSkuOffset = normalizedHtml.indexOf('"sku":"', skuOffset + 1);
  const segment = normalizedHtml.slice(
    skuOffset,
    nextSkuOffset < 0 ? normalizedHtml.length : nextSkuOffset,
  );
  const rows: { label: string; value: string }[] = [];
  const featurePattern = /"label":"([^"]*)","value":(?:"([^"]*)"|([^,}]+))/g;
  for (const match of segment.matchAll(featurePattern)) {
    const label = match[1];
    const value = match[2] ?? match[3]?.trim();
    if (value && focusedLabels.has(label)) rows.push({ label, value });
  }
  if (rows.length !== focusedLabels.size)
    throw new Error(`Official page returned ${rows.length} of ${focusedLabels.size} pilot fields.`);
  return rows;
};

const capturedToDocument = (
  captured: CapturedSource,
  rows: readonly { label: string; value: string }[],
): ExtractedDocument => {
  const block: ExtractedBlock = {
    kind: 'table',
    text: rows.map((row) => `${row.label}: ${row.value}`).join(' '),
    section: 'Technical specifications',
    rows,
    locator: {
      fragment: `sku-${sku}-features`,
      section: 'Technical specifications',
      table: `sku-${sku}`,
    },
  };
  return { source: captured, title: 'MultiPlus 2000VA', blocks: [block], warnings: [] };
};

const enrichUnits = (facts: readonly ProductFact[]): ProductFact[] =>
  facts.map((fact) => ({
    ...fact,
    raw_unit: unitByLabel.get(fact.raw_label),
    source_locator: {
      ...fact.source_locator,
      fragment: `sku-${sku}-feature-${createHash('sha256')
        .update(fact.raw_label)
        .digest('hex')
        .slice(0, 12)}`,
    },
  }));

const normalizeFacts = (
  facts: readonly ProductFact[],
  source: ProductSource,
): NormalizedProductFact[] =>
  facts
    .map((fact) => normalizeProductFact(fact, source))
    .filter(
      (result): result is typeof result & { status: 'normalized'; fact: NormalizedProductFact } =>
        result.status === 'normalized' && result.fact !== undefined,
    )
    .map((result) => result.fact);

const candidateFactsFor = (
  facts: readonly ProductFact[],
  normalizedFacts: readonly NormalizedProductFact[],
): ProductFact[] =>
  facts.map(
    (fact) => normalizedFacts.find((normalized) => normalized.fact.id === fact.id)?.fact ?? fact,
  );

const safeCandidateValidation = (
  candidate: ProductCandidate,
  source: ProductSource,
  facts: readonly ProductFact[],
): IngestionValidation => {
  try {
    return validateProductCandidate(candidate, [source], facts);
  } catch (error) {
    return {
      status: 'invalid',
      ok: false,
      issues: [
        {
          code: 'candidate_validation_failed',
          category: 'invalid',
          path: 'candidate',
          message: String(error),
        },
      ],
    };
  }
};

const validateArtifacts = (
  source: ProductSource,
  facts: readonly ProductFact[],
  candidate: ProductCandidate,
  normalizedFacts: readonly NormalizedProductFact[],
): IngestionValidation => {
  const candidateFacts = candidateFactsFor(facts, normalizedFacts);
  const results = [
    validateProductSources([source]),
    validateProductFacts(candidateFacts, [source]),
    safeCandidateValidation(candidate, source, candidateFacts),
  ];
  return {
    status: results.some((result) => result.status === 'invalid')
      ? 'invalid'
      : results.some((result) => result.status === 'unresolved')
        ? 'unresolved'
        : 'valid',
    issues: results.flatMap((result) => result.issues),
    ok: results.every((result) => result.ok),
  };
};

const reviewReportFor = (
  artifact: Pick<PilotArtifact, 'pilot_target_identity' | 'policy_metadata'>,
  candidate: ProductCandidate,
  validation: IngestionValidation,
  facts: readonly ProductFact[],
): PilotReport => ({
  identity: artifact.pilot_target_identity,
  product_role: artifact.policy_metadata.product_role,
  sources_used: candidate.source_ids,
  normalized_fields: Object.keys(candidate.field_evidence).sort(),
  unresolved_or_unmapped_facts: facts
    .filter((fact) => !Object.values(candidate.field_evidence).flat().includes(fact.id))
    .map((fact) => ({ id: fact.id, label: fact.raw_label, value: String(fact.raw_value) })),
  conflicts: [],
  unsupported_source_media: [],
  validation,
  review_state: candidate.review_status,
  promotion_state: candidate.promotion_status,
  promotion_blocker: 'Human review is required; this artifact never writes data/components/.',
});

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        )
      : item,
  );

export const validatePersistedArtifact = (artifact: PilotArtifact): IngestionValidation => {
  const normalizedFacts = normalizeFacts(artifact.facts, artifact.source);
  const candidateFacts = candidateFactsFor(artifact.facts, normalizedFacts);
  const persistedCandidateValidation = safeCandidateValidation(
    artifact.candidate,
    artifact.source,
    candidateFacts,
  );
  const persistedValidation = validateArtifacts(
    artifact.source,
    artifact.facts,
    artifact.candidate,
    normalizedFacts,
  );
  const replayedCandidate = buildProductCandidate({
    id: artifact.candidate.id,
    identity: artifact.pilot_target_identity,
    sources: [artifact.source],
    facts: artifact.facts,
    normalized_facts: normalizedFacts,
  });
  const expectedReport = reviewReportFor(
    artifact,
    replayedCandidate,
    validateArtifacts(artifact.source, artifact.facts, replayedCandidate, normalizedFacts),
    artifact.facts,
  );
  const issues = [
    ...validateProductSources([artifact.source]).issues,
    ...validateProductFacts(candidateFacts, [artifact.source]).issues,
    ...persistedCandidateValidation.issues,
  ];
  if (canonical(artifact.candidate) !== canonical(replayedCandidate))
    issues.push({
      code: 'persisted_candidate_mismatch',
      category: 'invalid',
      path: 'candidate',
      message: 'Persisted candidate does not match deterministic replay.',
    });
  if (canonical(artifact.report) !== canonical(expectedReport))
    issues.push({
      code: 'persisted_report_mismatch',
      category: 'invalid',
      path: 'report',
      message: 'Persisted report does not match deterministic replay.',
    });
  if (artifact.source.product_identity_claim?.manufacturer_part_number !== sku)
    issues.push({
      code: 'source_identity_mismatch',
      category: 'invalid',
      path: 'source.product_identity_claim',
      message: `Source identity must contain MPN ${sku}.`,
    });
  if (artifact.source_identity_evidence?.manufacturer_part_number !== sku)
    issues.push({
      code: 'source_identity_evidence_mismatch',
      category: 'invalid',
      path: 'source_identity_evidence',
      message: `Source identity evidence must contain MPN ${sku}.`,
    });
  return {
    status: issues.some((issue) => issue.category === 'invalid')
      ? 'invalid'
      : persistedValidation.status,
    issues,
    ok: !issues.some((issue) => issue.category === 'invalid'),
  };
};

export const makeArtifacts = (captured: CapturedSource): PilotArtifact => {
  const rows = extractSkuFeatures(captured.body.text ?? '');
  const extracted = extractProductFacts(capturedToDocument(captured, rows), {
    source_id: sourceId,
    extraction_method: 'structured',
  });
  const facts = enrichUnits(extracted.facts);
  const source: ProductSource = {
    ...createProductSource(captured, {
      id: sourceId,
      source_type: 'manufacturer_product_page',
      authority: 'manufacturer_product',
      publisher: 'Victron Energy',
      manufacturer: 'Victron Energy',
    }),
    product_identity_claim: { manufacturer: 'Victron Energy', manufacturer_part_number: sku },
    redistribution_status: 'link_only',
    notes: 'Source-observed MPN is recorded separately from the pilot target identity.',
  };
  const normalizedFacts = normalizeFacts(facts, source);
  const candidate = buildProductCandidate({
    id: candidateId,
    identity,
    sources: [source],
    facts,
    normalized_facts: normalizedFacts,
  });
  const validation = validateArtifacts(source, facts, candidate, normalizedFacts);
  const artifact = {
    schema_version: '1.0',
    captured_at: captured.retrieved_at,
    pilot_target_identity: identity,
    source_identity_evidence: {
      source_id: sourceId,
      manufacturer_part_number: sku,
      raw_value: sku,
      locator: { fragment: `sku-${sku}`, section: 'Product identity' },
      extraction_method: 'structured' as const,
      provenance_type: 'source_observed' as const,
    },
    policy_metadata: policyMetadata,
    source,
    facts,
    candidate,
  };
  return { ...artifact, report: reviewReportFor(artifact, candidate, validation, facts) };
};

export const replayArtifact = (artifact: PilotArtifact) => {
  const validation = validatePersistedArtifact(artifact);
  if (!validation.ok) throw new Error(JSON.stringify(validation));
  return { candidate: artifact.candidate, report: artifact.report, validation };
};
