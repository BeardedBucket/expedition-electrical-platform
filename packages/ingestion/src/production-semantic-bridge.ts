import { resolveCanonicalField, isSupportedCanonicalField } from './field-mapping.js';
import {
  artifactDigest,
  artifactReference,
  deterministicSerialize,
  PRODUCTION_SCHEMA_VERSION,
  type QualifiedFactArtifact,
  type SemanticProposal,
  type SourceAcquisitionArtifact,
} from './production-contracts.js';
import {
  reconcileQualifiedFactsForWholeIntake,
  type QualifiedFactGroupReconciliationOutcome,
  type QualifiedFactWholeIntakeReconciliationResult,
} from './reconciliation.js';
import { parseExactUnitValue } from './units.js';
import type { JsonValue } from './contracts.js';

const METHOD_VERSION = 'production-semantic-bridge.v3';

export interface ProductionSemanticBridgeInput {
  readonly facts: readonly QualifiedFactArtifact[];
  readonly source_acquisitions: readonly SourceAcquisitionArtifact[];
  readonly reconciliation: QualifiedFactWholeIntakeReconciliationResult;
}

/** F outcomes are evidence comparisons, never approval or canonical truth. */
export const buildProductionSemanticProposals = (
  input: ProductionSemanticBridgeInput,
): readonly SemanticProposal[] => {
  const expected = reconcileQualifiedFactsForWholeIntake({
    facts: input.facts,
    source_acquisitions: input.source_acquisitions,
  });
  if (deterministicSerialize(expected) !== deterministicSerialize(input.reconciliation)) {
    throw new Error('Semantic bridge received an F result inconsistent with its supplied inputs.');
  }

  const factsById = new Map(input.facts.map((fact) => [fact.id, fact]));
  const acquisitionDigests = input.source_acquisitions.map(artifactDigest);
  const reconciliationDigest = artifactDigest(input.reconciliation);

  const propose = (
    ids: readonly string[],
    outcome: QualifiedFactGroupReconciliationOutcome,
    reason: string,
  ): SemanticProposal => {
    const facts = [...ids].sort().map((id) => {
      const fact = factsById.get(id);
      if (!fact) throw new Error(`Semantic bridge cannot resolve qualified fact '${id}'.`);
      return fact;
    });
    const label = facts[0]?.metadata.source_label;
    const mapping = label ? resolveCanonicalField(label) : undefined;
    const target =
      mapping?.canonical_field ??
      (label
        ? `source_label:${label.trim().replace(/\s+/g, ' ').toLowerCase()}`
        : 'source_label:unavailable');
    const unsafe = facts.some(
      (fact) =>
        (fact.qualification_state !== 'exact' &&
          fact.qualification_state !== 'structurally_supported') ||
        fact.metadata.conditions !== undefined ||
        fact.metadata.duration !== undefined ||
        fact.metadata.temperature_context !== undefined ||
        fact.metadata.revision_context !== undefined ||
        fact.metadata.derived_value !== undefined ||
        fact.metadata.derivation !== undefined ||
        fact.metadata.alternative_interpretations !== undefined ||
        /\b(?:vac|vdc)\b/i.test(fact.metadata.source_unit ?? '') ||
        (typeof fact.metadata.raw_value === 'string' &&
          /\b(?:vac|vdc)\b/i.test(fact.metadata.raw_value)),
    );

    let disposition: SemanticProposal['disposition'] = 'unresolved';
    let proposedValue: JsonValue | undefined;
    let rationale = reason;
    if (outcome === 'conflict') {
      disposition = 'conflicting';
    } else if (outcome === 'agreement' || outcome === 'single_observation') {
      if (unsafe) {
        rationale = `${reason}; contextual or qualification information requires review`;
      } else if (!mapping) {
        disposition = 'unsupported';
        rationale = `${reason}; no explicit canonical field mapping`;
      } else if (mapping.target_kind === 'evidence') {
        disposition = 'evidence_only';
        rationale = `${reason}; mapping explicitly targets evidence`;
      } else if (!isSupportedCanonicalField(mapping.canonical_field)) {
        disposition = 'unsupported';
        rationale = `${reason}; canonical target is not supported`;
      } else {
        const values = facts.map((fact) => {
          if (mapping.value_kind === 'structured') {
            const raw = fact.metadata.raw_value;
            return mapping.normalize_value?.(
              typeof raw === 'string' ? raw : String(raw),
              fact.metadata.source_unit,
            );
          }
          const parsed = parseExactUnitValue(fact.metadata.raw_value, fact.metadata.source_unit);
          if (!parsed || parsed.unit.dimension !== mapping.dimension) return undefined;
          const value = parsed.unit.toCanonical(parsed.value);
          return Number.isFinite(value) ? value : undefined;
        });
        if (
          values.every((value) => value !== undefined) &&
          (mapping.value_kind !== 'structured' ||
            values.every(
              (value) => deterministicSerialize(value) === deterministicSerialize(values[0]),
            ))
        ) {
          disposition = 'mapped';
          proposedValue = values[0];
          rationale = `${reason}; explicit source-label mapping and safely qualified values`;
        } else {
          rationale = `${reason}; mapped values cannot be safely normalized to one value`;
        }
      }
    }

    const factRefs = facts.map((fact) =>
      artifactReference('qualified_fact', fact, fact.id, fact.schema_version),
    );
    const evidenceRefs = facts.flatMap((fact) => [
      fact.source_capture,
      ...(fact.source_acquisition ? [fact.source_acquisition] : []),
      ...(fact.document_extraction ? [fact.document_extraction] : []),
      ...(fact.evidence?.flatMap((evidence) =>
        evidence.source_reference ? [evidence.source_reference] : [],
      ) ?? []),
    ]);
    const stableRefs = [
      ...new Map(evidenceRefs.map((ref) => [`${ref.kind}:${ref.digest}`, ref] as const)).values(),
    ].sort((left, right) =>
      `${left.kind}:${left.digest}`.localeCompare(`${right.kind}:${right.digest}`),
    );
    const inputDigests = [
      ...new Set([
        ...factRefs.map((ref) => ref.digest),
        ...acquisitionDigests,
        reconciliationDigest,
      ]),
    ].sort();
    const alternatives =
      disposition === 'conflicting' || disposition === 'unresolved'
        ? facts.map((fact) => ({
            value: fact.metadata.raw_value,
            rationale:
              `Qualified fact ${fact.id}; state=${fact.qualification_state ?? 'unknown'}; ` +
              `source wording=${fact.metadata.source_wording}; ` +
              `context=${deterministicSerialize({
                source_unit: fact.metadata.source_unit,
                conditions: fact.metadata.conditions,
                duration: fact.metadata.duration,
                temperature_context: fact.metadata.temperature_context,
                revision_context: fact.metadata.revision_context,
                derived_value: fact.metadata.derived_value,
                derivation: fact.metadata.derivation,
                alternative_interpretations: fact.metadata.alternative_interpretations,
              })}`,
          }))
        : undefined;
    const content = {
      target,
      disposition,
      ...(proposedValue !== undefined ? { proposed_value: proposedValue } : {}),
      ...(alternatives ? { alternatives } : {}),
      fact_refs: factRefs,
      evidence_refs: stableRefs,
      provenance: { method: 'rule' as const, rule_version: METHOD_VERSION, rationale },
      input_artifact_digests: inputDigests,
    };
    return {
      schema_version: PRODUCTION_SCHEMA_VERSION,
      artifact_kind: 'semantic_proposal',
      id: `semantic-proposal.${artifactDigest(content).slice('sha256:'.length, 'sha256:'.length + 24)}`,
      ...content,
    };
  };

  const proposals = input.reconciliation.group_reconciliations.map((result) =>
    propose(result.qualified_fact_ids, result.outcome, `F group ${result.outcome}`),
  );
  for (const [reason, ids] of [
    ['unscoped', input.reconciliation.unscoped_qualified_fact_ids],
    ['scope-inconsistent', input.reconciliation.scope_inconsistent_qualified_fact_ids],
    ['label-unavailable', input.reconciliation.label_unavailable_qualified_fact_ids],
  ] as const) {
    proposals.push(...ids.map((id) => propose([id], 'unresolved', `F ${reason} fact`)));
  }
  return proposals.sort((left, right) => left.id.localeCompare(right.id));
};
