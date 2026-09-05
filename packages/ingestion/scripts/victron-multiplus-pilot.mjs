import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  HttpSourceCaptureAdapter,
  buildProductCandidate,
  createProductSource,
  extractProductFacts,
  normalizeProductFact,
  validateProductCandidate,
  validateProductFacts,
  validateProductSources,
} from '../dist/index.js';

const productUrl = 'https://www.victronenergy.com/inverters-chargers/multiplus-2000-va';
const sku = 'PMP242200100';
const sourceId = 'victron.multiplus-24-2000-50-50-120v.product-page';
const candidateId = 'victron.multiplus-24-2000-50-50-120v.pmp242200100';
const outputPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../data/ingestion/victron-multiplus-24-2000-50-50-120v.json',
);

const identity = {
  manufacturer: 'Victron Energy',
  product_family: 'MultiPlus',
  model: '24/2000/50-50 120V VE.Bus',
  manufacturer_part_number: sku,
  regional_variant: '120V',
  voltage_variant: '24V DC input',
  lifecycle_status: 'discontinued',
};
const policyMetadata = {
  authority: 'manufacturer_product',
  lifecycle_status: 'discontinued',
  product_role: 'inverter_charger',
};

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

const unitByLabel = new Map([
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

const extractSkuFeatures = (html) => {
  html = html.replace(/\\"/g, '"');
  const skuOffset = html.indexOf(`"sku":"${sku}"`);
  if (skuOffset < 0) throw new Error(`Official page did not contain SKU ${sku}.`);
  const nextSkuOffset = html.indexOf('"sku":"', skuOffset + 1);
  const segment = html.slice(skuOffset, nextSkuOffset < 0 ? html.length : nextSkuOffset);
  const rows = [];
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

const capturedToDocument = (captured, rows) => ({
  source: captured,
  title: 'MultiPlus 2000VA',
  blocks: [
    {
      kind: 'table',
      text: rows.map((row) => `${row.label}: ${row.value}`).join(' '),
      section: 'Technical specifications',
      rows,
      locator: {
        fragment: `sku-${sku}-features`,
        section: 'Technical specifications',
        table: `sku-${sku}`,
      },
    },
  ],
  warnings: [],
});

const enrichUnits = (facts) =>
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

const validateArtifacts = (source, facts, candidate, normalizedFacts) => {
  const candidateFacts = facts.map(
    (fact) => normalizedFacts.find((normalized) => normalized.fact.id === fact.id)?.fact ?? fact,
  );
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

const safeCandidateValidation = (candidate, source, facts) => {
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

const candidateFactsFor = (facts, normalizedFacts) =>
  facts.map(
    (fact) => normalizedFacts.find((normalized) => normalized.fact.id === fact.id)?.fact ?? fact,
  );

const reviewReportFor = (artifact, candidate, validation, facts) => ({
  identity: artifact.pilot_target_identity,
  product_role: artifact.policy_metadata.product_role,
  sources_used: candidate.source_ids,
  normalized_fields: Object.keys(candidate.field_evidence).sort(),
  unresolved_or_unmapped_facts: facts
    .filter((fact) => !Object.values(candidate.field_evidence).flat().includes(fact.id))
    .map((fact) => ({ id: fact.id, label: fact.raw_label, value: fact.raw_value })),
  conflicts: [],
  unsupported_source_media: [],
  validation,
  review_state: candidate.review_status,
  promotion_state: candidate.promotion_status,
  promotion_blocker: 'Human review is required; this artifact never writes data/components/.',
});

export const validatePersistedArtifact = (artifact) => {
  const source = artifact.source;
  const facts = artifact.facts;
  const normalizedFacts = facts
    .map((fact) => normalizeProductFact(fact, source))
    .filter((result) => result.status === 'normalized' && result.fact)
    .map((result) => result.fact);
  const candidateFacts = candidateFactsFor(facts, normalizedFacts);
  const persistedCandidateValidation = safeCandidateValidation(
    artifact.candidate,
    source,
    candidateFacts,
  );
  const persistedValidation = validateArtifacts(source, facts, artifact.candidate, normalizedFacts);
  const replayedCandidate = buildProductCandidate({
    id: artifact.candidate.id,
    identity: artifact.pilot_target_identity,
    sources: [source],
    facts,
    normalized_facts: normalizedFacts,
  });
  const replayedValidation = validateArtifacts(source, facts, replayedCandidate, normalizedFacts);
  const expectedReport = reviewReportFor(artifact, replayedCandidate, replayedValidation, facts);
  const issues = [
    ...validateProductSources([source]).issues,
    ...validateProductFacts(candidateFacts, [source]).issues,
    ...persistedCandidateValidation.issues,
  ];
  const canonical = (value) =>
    JSON.stringify(value, (_, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
          )
        : item,
    );
  if (canonical(artifact.candidate) !== canonical(replayedCandidate))
    issues.push({ code: 'persisted_candidate_mismatch', category: 'invalid', path: 'candidate' });
  if (canonical(artifact.report) !== canonical(expectedReport))
    issues.push({ code: 'persisted_report_mismatch', category: 'invalid', path: 'report' });
  if (artifact.source.product_identity_claim?.manufacturer_part_number !== sku)
    issues.push({
      code: 'source_identity_mismatch',
      category: 'invalid',
      path: 'source.product_identity_claim',
    });
  if (artifact.source_identity_evidence?.manufacturer_part_number !== sku)
    issues.push({
      code: 'source_identity_evidence_mismatch',
      category: 'invalid',
      path: 'source_identity_evidence',
    });
  return {
    status: issues.some((issue) => issue.category === 'invalid')
      ? 'invalid'
      : persistedValidation.status,
    issues,
    ok: !issues.some((issue) => issue.category === 'invalid'),
  };
};

const makeArtifacts = (captured) => {
  const rows = extractSkuFeatures(captured.body.text ?? '');
  const extracted = extractProductFacts(capturedToDocument(captured, rows), {
    source_id: sourceId,
    extraction_method: 'structured',
  });
  const facts = enrichUnits(extracted.facts);
  const source = {
    ...createProductSource(captured, {
      id: sourceId,
      source_type: 'manufacturer_product_page',
      authority: 'manufacturer_product',
      publisher: 'Victron Energy',
      manufacturer: 'Victron Energy',
    }),
    product_identity_claim: {
      manufacturer: 'Victron Energy',
      manufacturer_part_number: sku,
    },
    redistribution_status: 'link_only',
    notes: 'Source-observed MPN is recorded separately from the pilot target identity.',
  };
  const normalizedFacts = facts
    .map((fact) => normalizeProductFact(fact, source))
    .filter((result) => result.status === 'normalized' && result.fact)
    .map((result) => result.fact);
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
      extraction_method: 'structured',
      provenance_type: 'source_observed',
    },
    policy_metadata: policyMetadata,
    source,
    facts,
    candidate,
  };
  artifact.report = reviewReportFor(artifact, candidate, validation, facts);
  return artifact;
};

export const replayArtifact = (artifact) => {
  const validation = validatePersistedArtifact(artifact);
  if (!validation.ok) throw new Error(JSON.stringify(validation));
  return {
    candidate: artifact.candidate,
    report: artifact.report,
    validation,
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--replay')) {
    const artifact = JSON.parse(await readFile(outputPath, 'utf8'));
    process.stdout.write(`${JSON.stringify(replayArtifact(artifact), null, 2)}\n`);
  } else {
    const capture = await new HttpSourceCaptureAdapter().capture({ uri: productUrl });
    if (capture.status !== 'success' || !capture.source?.body.text)
      throw new Error(`Victron capture failed: ${JSON.stringify(capture.issues)}`);
    const artifacts = makeArtifacts(capture.source);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifacts, null, 2)}\n`, 'utf8');
    process.stdout.write(`Wrote ${outputPath}\n`);
  }
}
