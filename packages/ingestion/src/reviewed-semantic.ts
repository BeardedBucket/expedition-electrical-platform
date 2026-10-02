import {
  artifactDigest,
  artifactReference,
  deterministicSerialize,
  validateProductionArtifactSchema,
  type ArtifactReference,
  type ProductIntake,
  type QualifiedFactArtifact,
  type ReviewedSemanticDecision,
  type ReviewedSemanticDecisionReference,
  type ReviewedSemanticInterpretation,
  type ReviewedSemanticInterpretationEntry,
  type SemanticProposal,
  type SourceAcquisitionArtifact,
} from './production-contracts.js';
import type { JsonValue } from './contracts.js';
import { buildProductionSemanticProposals } from './production-semantic-bridge.js';
import {
  productionSemanticFieldDescriptor,
  productionSemanticFieldDescriptors,
  productionSemanticValueMatchesTarget,
  normalizeProductionSemanticTarget,
  validateProductionSemanticTargetContracts,
  type ProductionSemanticFieldDescriptor,
} from './field-mapping.js';
import { reviewedSemanticContext } from './semantic-context.js';
import type { QualifiedFactWholeIntakeReconciliationResult } from './reconciliation.js';
import { parseExactUnitValue, resolveUnit } from './units.js';

export const REVIEWED_SEMANTIC_POLICY_VERSION = 'reviewed-semantic.v1';

export interface ReviewedSemanticInput {
  readonly intake: ProductIntake;
  readonly source_acquisitions: readonly SourceAcquisitionArtifact[];
  readonly facts: readonly QualifiedFactArtifact[];
  readonly reconciliation: QualifiedFactWholeIntakeReconciliationResult;
  readonly proposals: readonly SemanticProposal[];
  readonly decisions?: readonly ReviewedSemanticDecision[];
}

const sorted = <T>(items: readonly T[], key: (item: T) => string): T[] =>
  [...items].sort((left, right) => key(left).localeCompare(key(right)));
const same = (left: unknown, right: unknown): boolean =>
  deterministicSerialize(left) === deterministicSerialize(right);
export const deterministicNormalizedValuesEqual = (left: unknown, right: unknown): boolean => {
  if (typeof left === 'number' && typeof right === 'number')
    // Permit only binary floating-point conversion noise, not measurement tolerance.
    return (
      Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 4
    );
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length &&
      left.every((value, index) => deterministicNormalizedValuesEqual(value, right[index]))
    );
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord).sort();
    return (
      same(keys, Object.keys(rightRecord).sort()) &&
      keys.every((key) => deterministicNormalizedValuesEqual(leftRecord[key], rightRecord[key]))
    );
  }
  return same(left, right);
};
const canonicalizeConversionNoise = (value: JsonValue): JsonValue => {
  if (typeof value === 'number') {
    // Fifteen significant decimal digits remove conversion noise only inside the existing 4-ULP allowance.
    const concise = Number(value.toPrecision(15));
    return deterministicNormalizedValuesEqual(value, concise) ? concise : value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeConversionNoise);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, canonicalizeConversionNoise(item)]),
    );
  return value;
};
const refKey = (reference: ArtifactReference): string =>
  `${reference.kind}:${reference.reference ?? ''}:${reference.digest}`;
const decisionReference = (decision: ReviewedSemanticDecision): ReviewedSemanticDecisionReference =>
  artifactReference('reviewed_semantic_decision', decision, decision.id, decision.schema_version);

export const reviewedSemanticInputSnapshot = (
  input: Omit<ReviewedSemanticInput, 'decisions'>,
): string =>
  artifactDigest({
    intake: artifactDigest(input.intake),
    source_acquisitions: sorted(input.source_acquisitions, artifactDigest).map(artifactDigest),
    reconciliation: artifactDigest(input.reconciliation),
    facts: sorted(input.facts, (fact) => fact.id).map(artifactDigest),
    proposals: sorted(input.proposals, (proposal) => proposal.id).map(artifactDigest),
  });

export const validateReviewedSemanticDecision = (
  decision: ReviewedSemanticDecision,
): readonly string[] => {
  const issues = [...validateProductionArtifactSchema(decision)];
  if (decision.artifact_kind !== 'reviewed_semantic_decision')
    issues.push('Decision artifact kind is invalid.');
  if (decision.proposal_ref.kind !== 'semantic_proposal' || !decision.proposal_ref.reference)
    issues.push('Decision must identify its semantic proposal.');
  if (!Number.isSafeInteger(decision.revision) || decision.revision < 1)
    issues.push('Decision revision must be a positive safe integer.');
  if ((decision.revision === 1) !== (decision.previous_decision === undefined))
    issues.push('Revision 1 must have no predecessor; later revisions must identify one.');
  if (!decision.fact_refs.length) issues.push('Decision must bind at least one qualified fact.');
  if (
    new Set(decision.fact_refs.map(refKey)).size !== decision.fact_refs.length ||
    new Set((decision.selected_fact_refs ?? []).map(refKey)).size !==
      (decision.selected_fact_refs ?? []).length
  )
    issues.push('Decision fact references must be distinct.');
  if (
    (decision.selected_fact_refs ?? []).some(
      (reference) => !decision.fact_refs.some((bound) => same(bound, reference)),
    )
  )
    issues.push('Selected facts must be included in the decision evidence references.');
  if (
    ['map', 'reject', 'schema_gap', 'not_applicable'].includes(decision.outcome) &&
    !decision.rationale?.trim()
  )
    issues.push(`Outcome '${decision.outcome}' requires a rationale.`);
  if (decision.outcome === 'map') {
    if (!decision.target?.trim()) issues.push('Map decisions require a canonical target.');
    if (decision.normalized_value === undefined)
      issues.push('Map decisions require a normalized semantic value.');
  } else if (
    decision.target !== undefined ||
    decision.normalized_value !== undefined ||
    decision.normalized_unit !== undefined ||
    decision.source_unit !== undefined
  ) {
    issues.push(`Outcome '${decision.outcome}' cannot carry a canonical mapping.`);
  }
  if (decision.outcome === 'schema_gap') {
    if (!decision.schema_gap?.concept_key.trim() || !decision.schema_gap.explanation.trim())
      issues.push('Schema-gap decisions require a concept key and explanation.');
  } else if (decision.schema_gap !== undefined) {
    issues.push('Only schema-gap decisions may include schema-gap metadata.');
  }
  return issues;
};

const sourceUnitInRawValue = (fact: QualifiedFactArtifact): string | undefined => {
  if (typeof fact.metadata.raw_value !== 'string') return undefined;
  const match = fact.metadata.raw_value
    .trim()
    .match(/^[-+]?(?:(?:\d{1,3}(?:,\d{3})+)|(?:\d+(?:\.\d+)?)|(?:\.\d+))\s*(.+)$/);
  const unitText = match?.[1]?.trim();
  return unitText && resolveUnit(unitText) ? resolveUnit(unitText)?.symbol : undefined;
};

export const effectiveReviewedSemanticSourceUnit = (
  fact: QualifiedFactArtifact,
  reviewedSourceUnit?: string,
): string | undefined => {
  const retainedUnit = fact.metadata.source_unit;
  const retained = retainedUnit ? resolveUnit(retainedUnit) : undefined;
  const explicitUnit = sourceUnitInRawValue(fact);
  if (reviewedSourceUnit) {
    const requested = resolveUnit(reviewedSourceUnit);
    if (!requested) throw new Error(`Source unit '${reviewedSourceUnit}' is unsupported.`);
    if (retained && retained.id !== requested.id)
      throw new Error(`Source unit '${reviewedSourceUnit}' contradicts retained source metadata.`);
    if (!retained && (!explicitUnit || resolveUnit(explicitUnit)?.id !== requested.id))
      throw new Error('A recovered source unit must be explicit in retained raw evidence.');
    return requested.symbol;
  }
  return retained?.symbol ?? explicitUnit;
};

export type ReviewedSemanticTargetDescriptor = ProductionSemanticFieldDescriptor;

export interface ReviewedSemanticMappingPreview {
  readonly target: string;
  readonly selected_fact_ids: readonly string[];
  readonly source_assertions: readonly {
    readonly fact_id: string;
    readonly source_label?: string;
    readonly raw_value: JsonValue;
    readonly source_unit?: string;
    readonly effective_source_unit?: string;
  }[];
  readonly normalized_value: JsonValue;
  readonly normalized_unit: string;
  readonly source_unit?: string;
}

/** Selectable fields come only from explicit canonical contracts, never label aliases. */
export const reviewedSemanticTargetsForFacts = (
  selectedFacts: readonly QualifiedFactArtifact[],
  allFacts: readonly QualifiedFactArtifact[],
  acquisitions: readonly SourceAcquisitionArtifact[],
): readonly ReviewedSemanticTargetDescriptor[] => {
  const contexts = selectedFacts.map((fact) =>
    reviewedSemanticContext(fact, allFacts, acquisitions),
  );
  return productionSemanticFieldDescriptors()
    .filter((descriptor) =>
      contexts.every((context) =>
        productionSemanticFieldDescriptor(
          descriptor.canonical_field,
          context?.role,
          context?.region,
        ),
      ),
    )
    .sort((left, right) => left.canonical_field.localeCompare(right.canonical_field))
    .map(
      ({
        canonical_field,
        value_shapes,
        dimension,
        unit,
        allows_unit_conversion,
        allowed_roles,
        allowed_regions,
        human_adjudication,
        normalizer_version,
      }) => ({
        canonical_field,
        value_shapes,
        dimension,
        unit,
        allows_unit_conversion,
        ...(allowed_roles ? { allowed_roles } : {}),
        ...(allowed_regions ? { allowed_regions } : {}),
        human_adjudication,
        normalizer_version,
      }),
    );
};

/** Pure, non-persisting normalization shared with persisted decision replay. */
export const previewReviewedSemanticMapping = (
  target: string,
  selectedFacts: readonly QualifiedFactArtifact[],
  allFacts: readonly QualifiedFactArtifact[],
  acquisitions: readonly SourceAcquisitionArtifact[],
  reviewedSourceUnit?: string,
): ReviewedSemanticMappingPreview => {
  if (!selectedFacts.length) throw new Error('A map decision must select supporting evidence.');
  const contexts = selectedFacts.map((fact) =>
    reviewedSemanticContext(fact, allFacts, acquisitions),
  );
  if (
    contexts.some(
      (context) => !productionSemanticFieldDescriptor(target, context?.role, context?.region),
    )
  )
    throw new Error(`Canonical target '${target}' is unsupported for this fact context.`);
  const descriptor = productionSemanticFieldDescriptor(
    target,
    contexts[0]?.role,
    contexts[0]?.region,
  );
  if (!descriptor) throw new Error(`Canonical target '${target}' is not supported.`);
  if (reviewedSourceUnit && !descriptor.allows_unit_conversion)
    throw new Error(`Canonical target '${target}' does not allow source-unit recovery.`);
  const targetUnit =
    descriptor.unit !== 'structured' && descriptor.unit !== 'string'
      ? resolveUnit(descriptor.unit)
      : undefined;
  const normalized = selectedFacts.map((fact, index) => {
    const sourceUnit = effectiveReviewedSemanticSourceUnit(fact, reviewedSourceUnit);
    const parsed = targetUnit
      ? parseExactUnitValue(fact.metadata.raw_value, sourceUnit)
      : undefined;
    if (targetUnit && parsed && parsed.unit.dimension !== targetUnit.dimension)
      throw new Error(
        `Source unit '${parsed.unit.symbol}' is incompatible with target '${target}'.`,
      );
    const mapped = normalizeProductionSemanticTarget(
      target,
      fact.metadata.raw_value,
      sourceUnit,
      contexts[index],
      fact.metadata.source_label ?? fact.metadata.source_wording,
    );
    if (!mapped)
      throw new Error(
        `Retained source value for '${fact.id}' cannot be normalized to '${target}'.`,
      );
    if (mapped.qualifiers)
      throw new Error(
        `Retained source value for '${fact.id}' requires qualifiers not represented by the reviewed decision.`,
      );
    if (
      targetUnit &&
      mapped.sourceUnit &&
      resolveUnit(mapped.sourceUnit)?.dimension !== targetUnit.dimension
    )
      throw new Error(`Source unit '${mapped.sourceUnit}' is incompatible with '${target}'.`);
    return {
      fact,
      sourceUnit: mapped.sourceUnit ?? sourceUnit,
      value: canonicalizeConversionNoise(mapped.value),
    };
  });
  if (
    !productionSemanticValueMatchesTarget(
      target,
      normalized[0].value,
      contexts[0]?.role,
      contexts[0]?.region,
    )
  )
    throw new Error(`Value does not satisfy canonical target '${target}'.`);
  if (
    !normalized.every((item) => deterministicNormalizedValuesEqual(item.value, normalized[0].value))
  )
    throw new Error(
      `Selected source facts do not have one consistent normalized value for '${target}'.`,
    );
  return {
    target,
    selected_fact_ids: selectedFacts.map((fact) => fact.id),
    source_assertions: normalized.map(({ fact, sourceUnit }) => ({
      fact_id: fact.id,
      ...(fact.metadata.source_label ? { source_label: fact.metadata.source_label } : {}),
      raw_value: fact.metadata.raw_value,
      ...(fact.metadata.source_unit ? { source_unit: fact.metadata.source_unit } : {}),
      ...(sourceUnit ? { effective_source_unit: sourceUnit } : {}),
    })),
    normalized_value: normalized[0].value,
    normalized_unit: descriptor.unit,
    ...(reviewedSourceUnit ? { source_unit: resolveUnit(reviewedSourceUnit)?.symbol } : {}),
  };
};

const validateMappedDecision = (
  decision: ReviewedSemanticDecision,
  selectedFacts: readonly QualifiedFactArtifact[],
  allFacts: readonly QualifiedFactArtifact[],
  acquisitions: readonly SourceAcquisitionArtifact[],
): void => {
  const contexts = selectedFacts.map((fact) =>
    reviewedSemanticContext(fact, allFacts, acquisitions),
  );
  const descriptor = productionSemanticFieldDescriptor(
    decision.target!,
    contexts[0]?.role,
    contexts[0]?.region,
  );
  if (!descriptor) throw new Error(`Canonical target '${decision.target}' is not supported.`);
  if (
    !productionSemanticValueMatchesTarget(
      decision.target!,
      decision.normalized_value!,
      contexts[0]?.role,
      contexts[0]?.region,
    )
  )
    throw new Error(`Value does not satisfy canonical target '${decision.target}'.`);
  const targetUnit =
    descriptor.unit !== 'structured' && descriptor.unit !== 'string'
      ? resolveUnit(descriptor.unit)
      : undefined;
  if (
    targetUnit &&
    (!decision.normalized_unit || resolveUnit(decision.normalized_unit)?.id !== targetUnit.id)
  )
    throw new Error(`Canonical target '${decision.target}' requires unit '${descriptor.unit}'.`);
  if (
    !targetUnit &&
    decision.normalized_unit !== undefined &&
    decision.normalized_unit !== descriptor.unit
  )
    throw new Error(
      `Canonical target '${decision.target}' does not accept unit '${decision.normalized_unit}'.`,
    );
  if (decision.source_unit && !descriptor.allows_unit_conversion)
    throw new Error(`Canonical target '${decision.target}' does not allow unit conversion.`);

  const preview = previewReviewedSemanticMapping(
    decision.target!,
    selectedFacts,
    allFacts,
    acquisitions,
    decision.source_unit,
  );
  if (!deterministicNormalizedValuesEqual(preview.normalized_value, decision.normalized_value))
    throw new Error(
      `Reviewed value for '${decision.target}' is not supported by retained source fact '${preview.selected_fact_ids[0]}'.`,
    );
};

const chainForProposal = (
  proposalId: string,
  decisions: readonly ReviewedSemanticDecision[],
): readonly ReviewedSemanticDecision[] => {
  const chain = decisions
    .filter((decision) => decision.proposal_ref.reference === proposalId)
    .sort((left, right) => left.revision - right.revision);
  if (!chain.length) return chain;
  for (let index = 0; index < chain.length; index++) {
    const decision = chain[index];
    if (decision.revision !== index + 1)
      throw new Error(`Decision history for '${proposalId}' has a revision gap or duplicate.`);
    if (
      index === 0
        ? decision.previous_decision !== undefined
        : !decision.previous_decision ||
          decision.previous_decision.digest !== artifactDigest(chain[index - 1]) ||
          decision.previous_decision.reference !== chain[index - 1].id
    )
      throw new Error(`Decision history for '${proposalId}' has an invalid predecessor link.`);
  }
  return chain;
};

/** Replays decisions against current immutable inputs; stale events remain visible but inert. */
export const buildReviewedSemanticInterpretation = (
  input: ReviewedSemanticInput,
): ReviewedSemanticInterpretation => {
  validateProductionSemanticTargetContracts();
  const expected = buildAutomatic(input);
  if (
    !same(
      expected,
      sorted(input.proposals, (proposal) => proposal.id),
    )
  )
    throw new Error(
      'Reviewed semantic interpretation received stale or foreign automatic proposals.',
    );
  const baseInput = {
    intake: input.intake,
    source_acquisitions: input.source_acquisitions,
    facts: input.facts,
    reconciliation: input.reconciliation,
    proposals: input.proposals,
  };
  const inputSnapshot = reviewedSemanticInputSnapshot(baseInput);
  const proposals = sorted(input.proposals, (proposal) => proposal.id);
  const decisions = input.decisions ?? [];
  if (new Set(decisions.map((decision) => decision.id)).size !== decisions.length)
    throw new Error('Reviewed semantic decision IDs must be unique.');
  for (const decision of decisions) {
    const issues = validateReviewedSemanticDecision(decision);
    if (issues.length) throw new Error(issues.join('; '));
  }
  const factByDigest = new Map(input.facts.map((fact) => [artifactDigest(fact), fact]));
  const entries: ReviewedSemanticInterpretationEntry[] = [];
  const staleReferences: ReviewedSemanticDecisionReference[] = [];
  for (const proposal of proposals) {
    const chain = chainForProposal(proposal.id, decisions);
    if (chain.length && proposal.derivation)
      throw new Error('Reviewed semantic decisions apply only to source semantic proposals.');
    if (!chain.length) {
      entries.push({
        proposal_id: proposal.id,
        automatic_target: proposal.target,
        automatic_disposition: proposal.disposition,
        ...(proposal.proposed_value !== undefined
          ? { automatic_value: proposal.proposed_value }
          : {}),
        state: 'automatic',
      });
      continue;
    }
    const active = chain[chain.length - 1];
    const reference = decisionReference(active);
    const currentFactRefs = proposal.fact_refs ?? [];
    const currentBinding =
      active.proposal_ref.reference === proposal.id &&
      active.proposal_ref.digest === artifactDigest(proposal) &&
      active.input_snapshot === inputSnapshot;
    if (!currentBinding) {
      const stale = chain.map(decisionReference);
      staleReferences.push(...stale);
      entries.push({
        proposal_id: proposal.id,
        automatic_target: proposal.target,
        automatic_disposition: proposal.disposition,
        ...(proposal.proposed_value !== undefined
          ? { automatic_value: proposal.proposed_value }
          : {}),
        state: 'stale',
        stale_decision_refs: stale,
      });
      continue;
    }
    if (!same(sorted(active.fact_refs, refKey), sorted(currentFactRefs, refKey)))
      throw new Error(
        `Decision '${active.id}' contains foreign or incomplete qualified-fact references.`,
      );
    const selectedRefs = active.selected_fact_refs ?? active.fact_refs;
    const selectedFacts = selectedRefs.map((ref) => factByDigest.get(ref.digest));
    if (
      !selectedFacts.length ||
      selectedFacts.some((fact, index) => !fact || fact.id !== selectedRefs[index].reference)
    )
      throw new Error(`Decision '${active.id}' selects missing or foreign qualified facts.`);
    const facts = selectedFacts as QualifiedFactArtifact[];
    if (active.outcome === 'map')
      validateMappedDecision(active, facts, input.facts, input.source_acquisitions);
    entries.push({
      proposal_id: proposal.id,
      automatic_target: proposal.target,
      automatic_disposition: proposal.disposition,
      ...(proposal.proposed_value !== undefined
        ? { automatic_value: proposal.proposed_value }
        : {}),
      state: active.outcome === 'map' ? 'human_mapped' : active.outcome,
      decision_ref: reference,
      ...(active.target ? { target: active.target } : {}),
      ...(active.normalized_value !== undefined ? { value: active.normalized_value } : {}),
      ...(active.normalized_unit ? { normalized_unit: active.normalized_unit } : {}),
      ...(active.source_unit ? { source_unit: active.source_unit } : {}),
      ...(selectedRefs.length ? { selected_fact_refs: selectedRefs } : {}),
    });
  }
  const unknownProposalIds = [
    ...new Set(
      decisions
        .map((decision) => decision.proposal_ref.reference)
        .filter((id): id is string => !!id)
        .filter((id) => !proposals.some((proposal) => proposal.id === id)),
    ),
  ];
  for (const id of unknownProposalIds) {
    const chain = chainForProposal(id, decisions);
    if (!/^semantic-proposal\.[a-f0-9]{24}$/.test(id))
      throw new Error('Reviewed semantic decision references a foreign proposal.');
    const refs = chain.map(decisionReference);
    staleReferences.push(...refs);
    entries.push({
      proposal_id: id,
      automatic_target: '',
      automatic_disposition: 'unresolved',
      state: 'stale',
      stale_decision_refs: refs,
    });
  }
  return {
    input_snapshot: inputSnapshot,
    entries,
    stale_decision_refs: sorted(staleReferences, refKey),
  };
};

const buildAutomatic = (input: ReviewedSemanticInput): readonly SemanticProposal[] =>
  buildProductionSemanticProposals(input);
