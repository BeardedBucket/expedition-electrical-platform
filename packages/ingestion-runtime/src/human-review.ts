import {
  artifactDigest,
  artifactReference,
  validateHumanAdjudicationIntent,
  validateProductionArtifactSchema,
  humanStatementFact,
  replayHumanSourceFacts,
  previewHumanMapping,
  buildProductionSemanticProposals,
  reconcileQualifiedFactsForWholeIntake,
  reviewedSemanticInputSnapshot,
  buildProductionProductCandidate,
  buildProductionReviewPackage,
  type HumanAdjudicationEvent,
  type HumanAdjudicationIntent,
  type ReviewReadyProductionIngest,
  type ReviewedSemanticDecision,
} from '@expedition/ingestion';

export function createHumanSourceEvent(
  preparation: ReviewReadyProductionIngest,
  events: readonly HumanAdjudicationEvent[],
  intent: HumanAdjudicationIntent,
  actor: string,
  id: string,
  recordedAt: string,
  inputSnapshot: string,
): HumanAdjudicationEvent {
  if (!validateHumanAdjudicationIntent(intent))
    throw new Error(
      'Invalid source correction intent: use supported fields and a current contract version.',
    );
  if (!actor.trim()) throw new Error('Provide your local reviewer label.');
  const prior = events.filter((e) => e.intent.group_id === intent.group_id).at(-1);
  if (intent.previous_event_id !== prior?.id)
    throw new Error('The correction history changed; reload before revising this source group.');
  if (intent.action === 'add' && intent.replaces_fact_ids.length)
    throw new Error(
      'A missed specification adds evidence without replacing existing observations.',
    );
  if (['correct', 'split', 'group'].includes(intent.action) && !intent.replaces_fact_ids.length)
    throw new Error('Select the original source observations to correct or group.');
  if (intent.action === 'split' && intent.statements.length < 2)
    throw new Error('A split must retain at least two separate source assertions.');
  if (
    intent.action === 'group' &&
    preparation.reconciliation.group_reconciliations.some(
      (g) =>
        g.outcome === 'conflict' &&
        g.qualified_fact_ids.some((id) => intent.replaces_fact_ids.includes(id)),
    )
  )
    throw new Error(
      'Conflicting source observations cannot be collapsed by grouping; retain or adjudicate their competing evidence explicitly.',
    );
  if (intent.action === 'incomplete' && intent.disposition !== 'draft')
    throw new Error('Incomplete extraction remains a draft without engineering authority.');
  const originals = intent.replaces_fact_ids.map((id) =>
    preparation.qualified_facts.find((f) => f.id === id),
  );
  if (originals.some((f) => !f))
    throw new Error('Original source observations are no longer current.');
  if (intent.action === 'group' && originals.length > 1) {
    // Equal numbers in neighboring cells may describe distinct quantities.
    // Group only duplicate extraction fragments of the same retained value
    // position. A broader relation needs a future explicit source-group contract.
    const positions = (fact: NonNullable<(typeof originals)[number]>) =>
      fact.evidence?.filter((e) => e.role === 'value').map((e) => artifactDigest(e.locator)) ?? [];
    if (
      !positions(originals[0]!).some((position) =>
        originals.every((f) => positions(f!).includes(position)),
      )
    )
      throw new Error(
        'Separate source value positions remain distinct specifications; grouping requires the same retained value locator.',
      );
  }
  const facts =
    intent.disposition === 'draft'
      ? []
      : intent.statements.map((statement, index) => {
          const documentIds = new Set(
            [
              ...statement.citations,
              ...(statement.applicability.citation ? [statement.applicability.citation] : []),
            ].map((c) => c.document_id),
          );
          const documents = preparation.document_extractions.filter((d) => documentIds.has(d.id));
          const fact = humanStatementFact({
            version: 'human-adjudication.v1',
            event_id: id,
            statement_index: index,
            intake: preparation.intake,
            statement,
            documents,
          });
          if (validateProductionArtifactSchema(fact).length)
            throw new Error(
              'Human source assertion does not satisfy the versioned retained-evidence contract.',
            );
          if (
            originals.some(
              (original) => original!.source_capture.digest !== fact.source_capture.digest,
            )
          )
            throw new Error(
              'A correction cannot replace observations from another source capture.',
            );
          // Older qualifiers retain exact cell locators rather than document block IDs.
          // Match those existing coordinates inside the cited table; never infer a
          // relationship from neighboring tables or discard a different retained value.
          if (
            intent.action === 'group' &&
            originals.some(
              (original) =>
                !statement.wording.includes(String(original!.metadata.raw_value)) ||
                !original!.evidence?.some((e) =>
                  statement.citations.some((c) => {
                    const block = documents
                      .find((d) => d.id === c.document_id)
                      ?.blocks.find((b) => b.id === c.block_id);
                    return (
                      c.block_id === e.block_id ||
                      artifactDigest(block?.locator) === artifactDigest(e.locator) ||
                      block?.cells?.some(
                        (cell) =>
                          artifactDigest(cell.source_location) === artifactDigest(e.locator),
                      )
                    );
                  }),
                ),
            )
          )
            throw new Error(
              'Grouped extraction fragments need a shared retained source block and unchanged source values; unrelated specifications remain separate.',
            );
          if (statement.mapping) previewHumanMapping(fact, statement.mapping);
          return fact;
        });
  return {
    version: 'human-adjudication.v1',
    id,
    actor: { kind: 'operator_label', identifier: actor.trim() },
    recorded_at: recordedAt,
    revision: (prior?.revision ?? 0) + 1,
    ...(prior ? { previous_digest: artifactDigest(prior) } : {}),
    input_snapshot: inputSnapshot,
    intent,
    original_fact_refs: originals.map((f) =>
      artifactReference('qualified_fact', f!, f!.id, f!.schema_version),
    ),
    facts,
  };
}

/** Original preparation is retained intact. Effective facts are a deterministic
 * overlay; ordinary reconciliation and proposal generation still own conflicts.
 * Rebinding an unchanged human assertion after another source correction appends
 * a decision under the new whole-input snapshot, never rewrites an earlier event. */
export function rebuildHumanPreparation(
  original: ReviewReadyProductionIngest,
  events: readonly HumanAdjudicationEvent[],
  history: readonly ReviewedSemanticDecision[],
  newId?: () => string,
  recordedAt?: string,
): ReviewReadyProductionIngest {
  const facts = replayHumanSourceFacts(original.qualified_facts, events);
  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts,
    source_acquisitions: original.source_acquisitions,
  });
  const proposals = buildProductionSemanticProposals({
    source_acquisitions: original.source_acquisitions,
    facts,
    reconciliation,
  });
  const inputSnapshot = reviewedSemanticInputSnapshot({
    intake: original.intake,
    source_acquisitions: original.source_acquisitions,
    facts,
    reconciliation,
    proposals,
  });
  const decisions = [...history];
  if (newId && recordedAt)
    for (const proposal of proposals) {
      if (proposal.derivation) continue;
      const bound = facts.filter((f) =>
        proposal.fact_refs?.some((r) => r.reference === f.id && r.digest === artifactDigest(f)),
      );
      const human = bound.filter((f) => f.human_source);
      if (!human.length) continue;
      const prior = decisions.filter((d) => d.proposal_ref.reference === proposal.id).at(-1);
      if (prior?.input_snapshot === inputSnapshot) continue;
      // Competing or combined meanings are retained for explicit resolution, not chosen by order.
      const intent =
        human.length === 1 && bound.length === 1
          ? human[0].human_source!.statement.mapping
          : undefined;
      const preview = intent ? previewHumanMapping(human[0], intent) : undefined;
      const event = events.find((e) => e.id === human[0].human_source!.event_id)!;
      decisions.push({
        schema_version: '1.0',
        artifact_kind: 'reviewed_semantic_decision',
        id: newId(),
        revision: (prior?.revision ?? 0) + 1,
        ...(prior
          ? {
              previous_decision: artifactReference(
                'reviewed_semantic_decision',
                prior,
                prior.id,
                prior.schema_version,
              ),
            }
          : {}),
        proposal_ref: artifactReference(
          'semantic_proposal',
          proposal,
          proposal.id,
          proposal.schema_version,
        ),
        fact_refs: bound.map((f) => artifactReference('qualified_fact', f, f.id, f.schema_version)),
        selected_fact_refs: bound.map((f) =>
          artifactReference('qualified_fact', f, f.id, f.schema_version),
        ),
        input_snapshot: inputSnapshot,
        outcome: preview ? 'map' : 'unresolved',
        ...(preview
          ? {
              target: preview.target,
              normalized_value: preview.normalized_value,
              normalized_unit: preview.normalized_unit,
              human_mapping: intent,
              ...(preview.qualified_value ? { qualified_value: preview.qualified_value } : {}),
            }
          : {}),
        rationale: event.intent.rationale,
        actor: event.actor,
        recorded_at: recordedAt,
        validation_policy_version: 'human-adjudication.v1',
      });
    }
  const bridge = buildProductionProductCandidate({
    intake: original.intake,
    captures: original.captures,
    source_acquisitions: original.source_acquisitions,
    facts,
    reconciliation,
    proposals,
    reviewed_semantic_decisions: decisions,
  });
  const review_package = buildProductionReviewPackage({
    intake: original.intake,
    ...(original.source_resolution ? { source_resolution: original.source_resolution } : {}),
    reconciliation,
    bridge,
  });
  return { ...original, qualified_facts: facts, reconciliation, proposals, bridge, review_package };
}
