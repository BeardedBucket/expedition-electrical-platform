import { createHash } from 'node:crypto';
import { buildProductCandidate } from './candidate-builder.js';
import type { ProductCandidate, ProductFact, ProductIdentity, ProductSource } from './contracts.js';
import { createProductSource, type CapturedSource } from './capture-types.js';
import { extractProductFacts } from './fact-extraction.js';
import { extractDocument } from './document-extraction.js';
import { normalizeProductFact } from './normalize-fact.js';
import { evaluatePilotIdentityGate, type PilotConfig, type PilotProgress } from './pilot-config.js';
import { reconcileProductFacts } from './reconciliation.js';
import type { NormalizedProductFact, ProductReconciliationResult } from './normalization-types.js';
import {
  validateProductCandidate,
  validateProductFacts,
  validateProductSources,
  type IngestionValidation,
} from './validation.js';

export const epochCandidateId = 'epoch-batteries.24v-100ah-marine.b24100a-c';
export const epochSourceId = 'epoch-batteries.24v-100ah.product-page';
export const epochCollectionSourceId = 'epoch-batteries.24v-collection';

export const epochIdentity: ProductIdentity = {
  manufacturer: 'Epoch Batteries',
  product_family: '24V Lithium Batteries',
  model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
  manufacturer_part_number: 'B24100A-C',
  voltage_variant: '24V',
};

export const epochProductUrl =
  'https://www.epochbatteries.com/products/24v-100ah-marine-lithium-battery';

const epochHtml = `<!doctype html>
<html>
  <head><title>24V 100Ah Marine Lithium Battery | Epoch</title></head>
  <body>
    <h2>Voltage and capacity</h2>
    <table>
      <tr><th>Nominal capacity</th><td>100Ah</td></tr>
      <tr><th>Nominal voltage</th><td>25.6V nominal</td></tr>
      <tr><th>Nominal energy</th><td>2.56 kWh</td></tr>
    </table>
    <h2>Battery chemistry</h2>
    <table><tr><th>Chemistry</th><td>LiFePO4</td></tr></table>
    <h2>Current ratings</h2>
    <dl>
      <dt>Max continuous discharge</dt><dd>120A</dd>
      <dt>Max discharge peak current</dt><dd>200A</dd>
      <dt>Max discharge duration</dt><dd>60 seconds</dd>
    </dl>
    <h2>Dimensions and weight</h2>
    <table>
      <tr><th>Weight</th><td>48.5 lb</td></tr>
      <tr><th>Width</th><td>10.25 in</td></tr>
      <tr><th>Height</th><td>11 in</td></tr>
    </table>
    <h2>Charging</h2>
    <table>
      <tr><th>Recommended charge current</th><td>50A</td></tr>
      <tr><th>Charge current</th><td>150A for 10 seconds</td></tr>
    </table>
    <h2>Parallel / series connection</h2>
    <table>
      <tr><th>Series connection</th><td>Up to 2 batteries in series</td></tr>
      <tr><th>Parallel connection</th><td>Up to 4 batteries in parallel</td></tr>
    </table>
    <h2>Battery charging</h2>
    <table>
      <tr><th>Operating voltage range</th><td>20.0V–29.2V</td></tr>
    </table>
  </body>
</html>`;

export const epochCapturedSource: CapturedSource = {
  requested_uri: epochProductUrl,
  final_uri: epochProductUrl,
  media_type: 'text/html',
  retrieved_at: '2026-09-05T23:39:38.821Z',
  body: {
    bytes: new TextEncoder().encode(epochHtml),
    text: epochHtml,
  },
  response_status: 200,
  content_hash: `sha256:${createHash('sha256').update(epochHtml).digest('hex')}`,
};

export const epochPilotConfig: PilotConfig = {
  pilot_id: 'epoch-batteries.24v-100ah.identity-pilot',
  candidate_id: epochCandidateId,
  manufacturer_target: 'Epoch Batteries',
  target_identity: epochIdentity,
  expected_product_role: 'battery',
  expected_category: 'battery',
  identity_requirements: ['manufacturer', 'model', 'manufacturer_part_number'],
  sources: [
    {
      id: epochSourceId,
      uri: epochProductUrl,
      source_type: 'manufacturer_product_page',
      authority: 'manufacturer_product',
      publisher: 'Epoch Batteries',
      source_role: 'mixed',
      manufacturer: 'Epoch Batteries',
      identity_claim: {
        manufacturer: 'Epoch Batteries',
        model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
        manufacturer_part_number: 'B24100A-C',
        voltage_variant: '24V',
      },
      extraction_hints: {
        focused_labels: ['Nominal capacity', 'Weight', 'Width', 'Height'],
      },
    },
    {
      id: epochCollectionSourceId,
      uri: 'https://www.epochbatteries.com/collections/24v-lithium-batteries',
      source_type: 'manufacturer_product_page',
      authority: 'manufacturer_product',
      publisher: 'Epoch Batteries',
      source_role: 'identity',
      manufacturer: 'Epoch Batteries',
      identity_claim: {
        manufacturer: 'Epoch Batteries',
        product_family: '24V Lithium Batteries',
        voltage_variant: '24V',
      },
    },
  ],
  identity_first_stage: 'identity',
  specification_stage: 'specification',
};

export const epochProductSource: ProductSource = {
  ...createProductSource(epochCapturedSource, {
    id: epochSourceId,
    source_type: 'manufacturer_product_page',
    authority: 'manufacturer_product',
    publisher: 'Epoch Batteries',
    manufacturer: 'Epoch Batteries',
  }),
  product_identity_claim: {
    manufacturer: 'Epoch Batteries',
    model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
    manufacturer_part_number: 'B24100A-C',
    voltage_variant: '24V',
  },
  content_hash: epochCapturedSource.content_hash,
  applicability: 'direct_identity',
  applicability_reason:
    'Direct product page explicitly identifies B24100A-C and its 24V 100Ah model.',
  redistribution_status: 'link_only',
  notes:
    'Official product table publishes product name, SKU B24100A-C, nominal capacity, dimensions, weight, chemistry, and current ratings.',
};

export const epochCollectionSource: ProductSource = {
  schema_version: '1.0',
  id: epochCollectionSourceId,
  uri: 'https://www.epochbatteries.com/collections/24v-lithium-batteries',
  source_type: 'manufacturer_product_page',
  authority: 'manufacturer_product',
  publisher: 'Epoch Batteries',
  retrieved_at: '2026-09-05T23:39:38.821Z',
  manufacturer: 'Epoch Batteries',
  title: '24V Lithium Batteries | 50Ah to 230Ah LiFePO4 | Epoch',
  product_identity_claim: {
    manufacturer: 'Epoch Batteries',
    product_family: '24V Lithium Batteries',
    voltage_variant: '24V',
  },
  content_hash: 'sha256:7ebd6dce94151772fa4bc0f69a7f4a7efdfa6947a3acb5254a7f01b2fb7d25be',
  applicability: 'explicitly_reviewed',
  applicability_reason:
    'Official collection page is reviewed and associated with the 24V family; it is not treated as direct B24100A-C identity, only as family applicability evidence.',
  redistribution_status: 'link_only',
  notes:
    'Official collection identifies a 24V 100Ah model and describes V2-T only for the separate 24V 230Ah Elite product.',
};

export const epochSources: readonly ProductSource[] = [epochProductSource, epochCollectionSource];

export const legacyEpochSources: readonly ProductSource[] = [...epochSources];

const rawUnitByLabel = new Map<string, string | undefined>([
  ['Nominal capacity', 'Ah'],
  ['Nominal voltage', 'V'],
  ['Nominal energy', 'kWh'],
  ['Chemistry', undefined],
  ['Max continuous discharge', 'A'],
  ['Max discharge peak current', 'A'],
  ['Max discharge duration', 's'],
  ['Weight', 'lb'],
  ['Width', 'in'],
  ['Height', 'in'],
  ['Recommended charge current', 'A'],
  ['Charge current', 'A'],
  ['Series connection', undefined],
  ['Parallel connection', undefined],
  ['Operating voltage range', 'V'],
]);

const epochExtraction = (): readonly ProductFact[] => {
  const document = extractDocument(epochCapturedSource);
  const result = extractProductFacts(document, {
    source_id: epochSourceId,
    extraction_method: 'structured',
  });
  if (result.status === 'unsupported' || result.status === 'invalid') {
    throw new Error(
      `Epoch capture extraction failed: ${result.warnings[0]?.message ?? 'unsupported'}.`,
    );
  }
  return result.facts.map((fact) => ({
    ...fact,
    source_id: epochSourceId,
    field: 'unmapped',
    raw_unit: fact.raw_unit ?? rawUnitByLabel.get(fact.raw_label),
    review_required: true,
    transformation_notes: 'Raw claim only; no semantic mapping or unit conversion performed.',
    fact_state: 'provisional',
  }));
};

export const epochManualFacts: readonly ProductFact[] = [
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.nominal-capacity',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Nominal capacity',
    raw_value: '100Ah',
    raw_unit: 'Ah',
    source_locator: { section: 'Voltage and capacity', row: 'Nominal capacity' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-collection.nominal-capacity',
    source_id: epochCollectionSourceId,
    field: 'unmapped',
    raw_label: 'Nominal capacity',
    raw_value: '100Ah',
    raw_unit: 'Ah',
    source_locator: { section: '24V 100Ah: The Versatile All-Around Choice' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.weight',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Weight',
    raw_value: '48.5 lb',
    raw_unit: 'lb',
    source_locator: { section: 'Dimensions and weight', row: 'Weight' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.width',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Width',
    raw_value: '10.25 in',
    raw_unit: 'in',
    source_locator: { section: 'Dimensions and weight', row: 'Width' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.height',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Height',
    raw_value: '11 in',
    raw_unit: 'in',
    source_locator: { section: 'Dimensions and weight', row: 'Height' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.nominal-voltage',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Nominal voltage',
    raw_value: '25.6V nominal',
    raw_unit: 'V',
    source_locator: { section: 'Voltage and capacity', row: 'Nominal voltage' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.nominal-energy',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Nominal energy',
    raw_value: '2.56 kWh',
    raw_unit: 'kWh',
    source_locator: { section: 'Voltage and capacity', row: 'Nominal energy' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.chemistry',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Chemistry',
    raw_value: 'LiFePO4',
    source_locator: { section: 'Battery chemistry', row: 'Chemistry' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.max-continuous-discharge',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Max continuous discharge',
    raw_value: '120A',
    raw_unit: 'A',
    source_locator: { section: 'Current ratings', row: 'Max continuous discharge' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.max-discharge-peak-current',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Max discharge peak current',
    raw_value: '200A',
    raw_unit: 'A',
    source_locator: { section: 'Current ratings', row: 'Max discharge peak current' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.max-discharge-duration',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Max discharge duration',
    raw_value: '60 seconds',
    raw_unit: 's',
    source_locator: { section: 'Current ratings', row: 'Max discharge duration' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.recommended-charge-current',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Recommended charge current',
    raw_value: '50A',
    raw_unit: 'A',
    source_locator: { section: 'Charging', row: 'Recommended charge current' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.series-connection',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Series connection',
    raw_value: 'Up to 2 batteries in series',
    source_locator: { section: 'Parallel / series connection', row: 'Series connection' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.parallel-connection',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Parallel connection',
    raw_value: 'Up to 4 batteries in parallel',
    source_locator: { section: 'Parallel / series connection', row: 'Parallel connection' },
    extraction_method: 'manual',
    review_required: false,
    fact_state: 'verified',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.transient-charge-claim',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Charge current',
    raw_value: '150A for 10 seconds',
    raw_unit: 'A',
    source_locator: { section: 'Charging', row: 'Charge current' },
    extraction_method: 'manual',
    review_required: true,
    fact_state: 'unresolved',
    notes: 'Evidence-only transient charge claim that remains out of selected canonical facts.',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.operating-voltage-range',
    source_id: epochSourceId,
    field: 'unmapped',
    raw_label: 'Operating voltage range',
    raw_value: '20.0V–29.2V',
    raw_unit: 'V',
    source_locator: { section: 'Battery charging', row: 'Operating voltage range' },
    extraction_method: 'manual',
    review_required: true,
    fact_state: 'unresolved',
  },
] as const;

const normalizeFacts = (
  facts: readonly ProductFact[],
  sources: readonly ProductSource[],
): readonly NormalizedProductFact[] =>
  facts.flatMap((fact) => {
    const source = sources.find((item) => item.id === fact.source_id);
    if (!source) throw new Error(`Missing source '${fact.source_id}' for fact '${fact.id}'.`);
    const result = normalizeProductFact(fact, source);
    return result.status === 'normalized' && result.fact ? [result.fact] : [];
  });

export const epochFacts: readonly ProductFact[] = epochExtraction();

export const evaluateEpochIdentityGate = (): PilotProgress =>
  evaluatePilotIdentityGate(
    epochIdentity,
    [epochArtifact.source],
    epochPilotConfig.identity_requirements,
  );

export const reconcileEpochSpecifications = (): ProductReconciliationResult => {
  const identityGate = evaluateEpochIdentityGate();
  if (!identityGate.can_proceed_to_specification) {
    throw new Error(`Epoch specification ingestion is blocked by ${identityGate.status} identity.`);
  }
  return reconcileProductFacts({
    candidate_id: epochCandidateId,
    identity: epochIdentity,
    sources: [epochArtifact.source],
    facts: epochArtifact.facts,
    normalized_facts: normalizeFacts(epochArtifact.facts, [epochArtifact.source]),
  });
};

export interface EpochReport {
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

export interface EpochArtifact {
  readonly schema_version: string;
  readonly captured_at: string;
  readonly captured_source: CapturedSource;
  readonly pilot_target_identity: ProductIdentity;
  readonly source_identity_evidence: {
    readonly source_id: string;
    readonly manufacturer_part_number: string;
    readonly raw_value: string;
    readonly locator: { readonly fragment: string; readonly section: string };
    readonly extraction_method: 'structured';
    readonly provenance_type: 'source_observed';
  };
  readonly policy_metadata: {
    readonly authority: 'manufacturer_product';
    readonly lifecycle_status: 'active';
    readonly product_role: 'battery';
  };
  readonly source: ProductSource;
  readonly facts: readonly ProductFact[];
  readonly candidate: ProductCandidate;
  readonly report: EpochReport;
}

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
  artifact: Pick<EpochArtifact, 'pilot_target_identity' | 'policy_metadata'>,
  candidate: ProductCandidate,
  validation: IngestionValidation,
  facts: readonly ProductFact[],
): EpochReport => ({
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
  promotion_blocker: 'Human review is required; this artifact is noncanonical and not promoted.',
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

export const validatePersistedEpochArtifact = (artifact: EpochArtifact): IngestionValidation => {
  const capturedHash = `sha256:${createHash('sha256')
    .update(artifact.captured_source.body.text ?? '')
    .digest('hex')}`;
  const sourceHashMatches = artifact.source.content_hash === capturedHash;
  const sourceHashMatchesPersistedValue =
    artifact.source.content_hash === artifact.captured_source.content_hash;
  const normalizedFacts = normalizeFacts(artifact.facts, artifact.source ? [artifact.source] : []);
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
  if (!sourceHashMatches || !sourceHashMatchesPersistedValue) {
    issues.push({
      code: 'captured_content_hash_mismatch',
      category: 'invalid',
      path: 'source.content_hash',
      message: 'Source content hash does not match the persisted captured content.',
    });
  }
  if (canonical(artifact.candidate) !== canonical(replayedCandidate)) {
    issues.push({
      code: 'persisted_candidate_mismatch',
      category: 'invalid',
      path: 'candidate',
      message: 'Persisted candidate does not match deterministic replay.',
    });
  }
  if (canonical(artifact.report) !== canonical(expectedReport)) {
    issues.push({
      code: 'persisted_report_mismatch',
      category: 'invalid',
      path: 'report',
      message: 'Persisted report does not match deterministic replay.',
    });
  }
  if (artifact.source.product_identity_claim?.manufacturer_part_number !== 'B24100A-C') {
    issues.push({
      code: 'source_identity_mismatch',
      category: 'invalid',
      path: 'source.product_identity_claim',
      message: 'Source identity must contain MPN B24100A-C.',
    });
  }
  if (artifact.source_identity_evidence.manufacturer_part_number !== 'B24100A-C') {
    issues.push({
      code: 'source_identity_evidence_mismatch',
      category: 'invalid',
      path: 'source_identity_evidence',
      message: 'Source identity evidence must contain MPN B24100A-C.',
    });
  }
  return {
    status: issues.some((issue) => issue.category === 'invalid')
      ? 'invalid'
      : persistedValidation.status,
    issues,
    ok: !issues.some((issue) => issue.category === 'invalid'),
  };
};

export const makeEpochArtifact = (captured: CapturedSource): EpochArtifact => {
  const source: ProductSource = {
    ...createProductSource(captured, {
      id: epochSourceId,
      source_type: 'manufacturer_product_page',
      authority: 'manufacturer_product',
      publisher: 'Epoch Batteries',
      manufacturer: 'Epoch Batteries',
    }),
    product_identity_claim: {
      manufacturer: 'Epoch Batteries',
      model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
      manufacturer_part_number: 'B24100A-C',
      voltage_variant: '24V',
    },
    content_hash:
      captured.content_hash ??
      `sha256:${createHash('sha256')
        .update(captured.body.text ?? '')
        .digest('hex')}`,
    applicability: 'direct_identity',
    applicability_reason: 'Direct product page explicitly identifies 24V 100Ah battery B24100A-C.',
    redistribution_status: 'link_only',
    notes:
      'Official product page publishes product identity, capacity, chemistry, current limits, and recommended charge current.',
  };

  const facts = epochExtraction();
  const normalizedFacts = normalizeFacts(facts, [source]);
  const candidate = buildProductCandidate({
    id: epochCandidateId,
    identity: epochIdentity,
    sources: [source],
    facts,
    normalized_facts: normalizedFacts,
  });
  const validation = validateArtifacts(source, facts, candidate, normalizedFacts);
  const artifact: EpochArtifact = {
    schema_version: '1.0',
    captured_at: captured.retrieved_at,
    captured_source: captured,
    pilot_target_identity: epochIdentity,
    source_identity_evidence: {
      source_id: epochSourceId,
      manufacturer_part_number: 'B24100A-C',
      raw_value: 'B24100A-C',
      locator: { fragment: 'product-identity', section: 'Product identity' },
      extraction_method: 'structured',
      provenance_type: 'source_observed',
    },
    policy_metadata: {
      authority: 'manufacturer_product',
      lifecycle_status: 'active',
      product_role: 'battery',
    },
    source,
    facts,
    candidate,
    report: {
      identity: epochIdentity,
      product_role: 'battery',
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
      promotion_blocker:
        'Human review is required; this artifact is noncanonical and not promoted.',
    },
  };
  return artifact;
};

export const epochArtifact: EpochArtifact = makeEpochArtifact(epochCapturedSource);

export const replayEpochArtifact = (artifact: EpochArtifact) => {
  const validation = validatePersistedEpochArtifact(artifact);
  if (!validation.ok) throw new Error(JSON.stringify(validation));
  return { candidate: artifact.candidate, report: artifact.report, validation };
};

export const buildEpochCandidate = (): ProductCandidate =>
  replayEpochArtifact(epochArtifact).candidate;
