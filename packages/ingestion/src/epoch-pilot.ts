import { buildProductCandidate } from './candidate-builder.js';
import type { ProductCandidate, ProductFact, ProductIdentity, ProductSource } from './contracts.js';
import { normalizeProductFact } from './normalize-fact.js';
import { evaluatePilotIdentityGate, type PilotConfig, type PilotProgress } from './pilot-config.js';
import { reconcileProductFacts } from './reconciliation.js';
import type { NormalizedProductFact, ProductReconciliationResult } from './normalization-types.js';

export const epochCandidateId = 'epoch-batteries.24v-100ah-marine.b24100a-c';

export const epochIdentity: ProductIdentity = {
  manufacturer: 'Epoch Batteries',
  product_family: '24V Lithium Batteries',
  model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
  manufacturer_part_number: 'B24100A-C',
  voltage_variant: '24V',
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
      id: 'epoch-batteries.24v-100ah.product-page',
      uri: 'https://www.epochbatteries.com/products/24v-100ah-marine-lithium-battery',
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
      id: 'epoch-batteries.24v-collection',
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

export const epochSources: readonly ProductSource[] = [
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page',
    uri: 'https://www.epochbatteries.com/products/24v-100ah-marine-lithium-battery',
    source_type: 'manufacturer_product_page',
    authority: 'manufacturer_product',
    publisher: 'Epoch Batteries',
    retrieved_at: '2026-09-05T23:39:38.821Z',
    manufacturer: 'Epoch Batteries',
    title: '24V 100Ah Marine Lithium Battery | Heated & Bluetooth',
    product_identity_claim: {
      manufacturer: 'Epoch Batteries',
      model: '24V 100Ah LiFePO4 Battery (2.56kWh)',
      manufacturer_part_number: 'B24100A-C',
      voltage_variant: '24V',
    },
    redistribution_status: 'link_only',
    notes:
      'Official product table publishes product name, SKU B24100A-C, nominal capacity, dimensions, and weight.',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-collection',
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
    redistribution_status: 'link_only',
    notes:
      'Official collection identifies a 24V 100Ah model and describes V2-T only for the separate 24V 230Ah Elite product.',
  },
];

export const epochFacts: readonly ProductFact[] = [
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.nominal-capacity',
    source_id: 'epoch-batteries.24v-100ah.product-page',
    field: 'unmapped',
    raw_label: 'Nominal capacity',
    raw_value: '100Ah',
    raw_unit: 'Ah',
    source_locator: { section: 'Voltage and capacity', row: 'Nominal capacity' },
    extraction_method: 'manual',
    review_required: true,
    fact_state: 'provisional',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-collection.nominal-capacity',
    source_id: 'epoch-batteries.24v-collection',
    field: 'unmapped',
    raw_label: 'Nominal capacity',
    raw_value: '100Ah',
    raw_unit: 'Ah',
    source_locator: { section: '24V 100Ah: The Versatile All-Around Choice' },
    extraction_method: 'manual',
    review_required: true,
    fact_state: 'provisional',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.weight',
    source_id: 'epoch-batteries.24v-100ah.product-page',
    field: 'unmapped',
    raw_label: 'Weight',
    raw_value: '48.5 lb',
    raw_unit: 'lb',
    source_locator: { section: 'Dimensions and weight', row: 'Weight' },
    extraction_method: 'manual',
    review_required: true,
    fact_state: 'provisional',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.width',
    source_id: 'epoch-batteries.24v-100ah.product-page',
    field: 'unmapped',
    raw_label: 'Width',
    raw_value: '10.25 in',
    raw_unit: 'in',
    source_locator: { section: 'Dimensions and weight', row: 'Width' },
    extraction_method: 'manual',
    review_required: true,
    fact_state: 'provisional',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.height',
    source_id: 'epoch-batteries.24v-100ah.product-page',
    field: 'unmapped',
    raw_label: 'Height',
    raw_value: '11 in',
    raw_unit: 'in',
    source_locator: { section: 'Dimensions and weight', row: 'Height' },
    extraction_method: 'manual',
    review_required: true,
    fact_state: 'provisional',
  },
  {
    schema_version: '1.0',
    id: 'epoch-batteries.24v-100ah.product-page.max-continuous-discharge',
    source_id: 'epoch-batteries.24v-100ah.product-page',
    field: 'unmapped',
    raw_label: 'Max continuous discharge',
    raw_value: '120A',
    raw_unit: 'A',
    source_locator: { section: 'Current ratings', row: 'Max continuous discharge' },
    extraction_method: 'manual',
    review_required: true,
    fact_state: 'unresolved',
    notes: 'No existing canonical mapping preserves the exact maximum-discharge semantics.',
  },
];

const normalizedEpochFacts = (): readonly NormalizedProductFact[] =>
  epochFacts.flatMap((fact) => {
    const source = epochSources.find((item) => item.id === fact.source_id);
    if (!source) throw new Error(`Missing source '${fact.source_id}' for fact '${fact.id}'.`);
    const result = normalizeProductFact(fact, source);
    return result.status === 'normalized' && result.fact ? [result.fact] : [];
  });

export const evaluateEpochIdentityGate = (): PilotProgress =>
  evaluatePilotIdentityGate(epochIdentity, epochSources, epochPilotConfig.identity_requirements);

export const reconcileEpochSpecifications = (): ProductReconciliationResult => {
  const identityGate = evaluateEpochIdentityGate();
  if (!identityGate.can_proceed_to_specification) {
    throw new Error(`Epoch specification ingestion is blocked by ${identityGate.status} identity.`);
  }
  return reconcileProductFacts({
    candidate_id: epochCandidateId,
    identity: epochIdentity,
    sources: epochSources,
    facts: epochFacts,
    normalized_facts: normalizedEpochFacts(),
  });
};

export const buildEpochCandidate = (): ProductCandidate => {
  const identityGate = evaluateEpochIdentityGate();
  if (!identityGate.can_proceed_to_specification) {
    throw new Error(`Epoch candidate creation is blocked by ${identityGate.status} identity.`);
  }
  return buildProductCandidate({
    id: epochCandidateId,
    identity: epochIdentity,
    sources: epochSources,
    facts: epochFacts,
    normalized_facts: normalizedEpochFacts(),
  });
};
