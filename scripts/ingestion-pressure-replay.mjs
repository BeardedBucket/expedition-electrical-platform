import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserializeJob } from '../packages/ingestion-runtime/dist/codec.js';
import {
  artifactDigest,
  buildProductionSemanticProposals,
  buildProductionProductCandidate,
  reconcileQualifiedFactsForWholeIntake,
  evaluateSemanticReviewCompletion,
  qualifyDocumentExtraction,
  automaticEvidenceClassificationValid,
  SEMANTIC_RULE_INTERPRETER,
} from '@expedition/ingestion';

/** Offline semantic pressure replay. Input must already be a TEMP copy. No store,
 * adapter, preparation, approval, promotion or verification action is imported.
 * Membership comes only from the exact batch, never a filesystem traversal. */
export const classifyPressureProposal = (proposal, facts, nonProjected = []) => {
  const sourceFacts = facts.filter((f) =>
    proposal.fact_refs?.some((r) => r.reference === f.id && r.digest === artifactDigest(f)),
  );
  const labels = [
    ...new Set(
      sourceFacts.flatMap((f) => (f.metadata.source_label ? [f.metadata.source_label] : [])),
    ),
  ].sort();
  const recognized = (proposal.semantic_assertions ?? []).map((a) => ({
    concept: a.concept,
    rule_id: a.rule.id,
    rule_revision: a.rule.revision,
    rule_digest: a.rule.digest,
    interpreter: a.rule.interpreter,
    review_required_reasons: a.review_required_reasons,
  }));
  const reasons = [...new Set(recognized.flatMap((a) => a.review_required_reasons))].sort();
  const fallback = proposal.target.startsWith('source_label:')
    ? proposal.target.slice('source_label:'.length)
    : null;
  // This is diagnostic classification of the mapper's knowledge, not new
  // semantic authority. In particular an unknown label proves no schema gap.
  // This harness rejects human-decision inputs, so it can assert no reviewed
  // schema/model gap; a future reviewed audit needs separately validated proof.
  const automatic = automaticEvidenceClassificationValid(proposal);
  const category =
    proposal.disposition === 'mapped'
      ? 'automatically_mapped_engineering_assertion'
      : automatic
        ? 'automatic_retained_non_authoritative_evidence'
        : proposal.disposition === 'conflicting'
          ? 'conflict'
          : proposal.disposition === 'evidence_only'
            ? 'evidence_only'
            : recognized.length && reasons.some((r) => r !== 'value_or_unit_unresolved')
              ? 'recognized_concept_context_or_applicability_unresolved'
              : recognized.length && reasons.includes('value_or_unit_unresolved')
                ? 'recognized_concept_unresolved_value_or_unit'
                : recognized.length && proposal.disposition === 'unresolved'
                  ? 'recognized_concept_reconciliation_unresolved'
                  : fallback !== null
                    ? 'unrecognized_source_vocabulary'
                    : 'unclassified_unsupported_interpretation';
  return {
    proposal_id: proposal.id,
    source_labels: labels,
    fallback_source_label: fallback,
    normalized_source_labels: labels.map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ')),
    target: proposal.target,
    disposition: proposal.disposition,
    recognized,
    automatic_evidence_classification: proposal.evidence_classification ?? null,
    requires_human_semantic_disposition:
      !proposal.derivation && proposal.disposition !== 'mapped' && !automatic,
    automatic_rule_version: proposal.provenance.rule_version ?? null,
    review_required_reasons: reasons,
    category,
    workload_category: [
      'unrecognized_source_vocabulary',
      'unclassified_unsupported_interpretation',
      'evidence_only',
    ].includes(category)
      ? 'human_semantic_interpretation_required'
      : category,
    reason: proposal.provenance.rationale,
    non_projection_reasons: nonProjected
      .filter((p) => p.proposal_id === proposal.id)
      .map((p) => p.reason),
  };
};

export const replayPressureCorpus = (
  batchPath,
  outputPath,
  historicalPaths,
  interpreter = SEMANTIC_RULE_INTERPRETER,
) => {
  if (
    ![
      'semantic-assertions.v2',
      'semantic-assertions.v3',
      'semantic-assertions.v4',
      'semantic-assertions.v5',
      'semantic-assertions.v6',
      SEMANTIC_RULE_INTERPRETER,
    ].includes(interpreter)
  )
    throw new Error('Unsupported pressure interpreter.');
  const insideTemp = (path) => {
    // Windows TEMP may use an 8.3 alias. Accept its lexical spelling and its
    // resolved spelling, then also validate each physical input before reading.
    const contained = [resolve(tmpdir()), realpathSync(tmpdir())].some((root) => {
      const rel = relative(root, path);
      return !rel.startsWith('..') && resolve(rel) !== rel;
    });
    if (!contained) throw new Error('Pressure replay requires explicit TEMP paths.');
  };
  insideTemp(resolve(batchPath));
  insideTemp(realpathSync(batchPath));
  insideTemp(resolve(outputPath));
  insideTemp(realpathSync(dirname(resolve(outputPath))));
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const hashes = new Map();
  const load = (path) => {
    insideTemp(realpathSync(path));
    const bytes = readFileSync(path),
      envelope = JSON.parse(bytes);
    if (typeof envelope.payload !== 'string' || sha(envelope.payload) !== envelope.digest)
      throw new Error('Envelope integrity mismatch.');
    hashes.set(path, sha(bytes));
    return deserializeJob(envelope.payload);
  };
  const batch = load(batchPath);
  if (
    !Array.isArray(batch.job_ids) ||
    new Set(batch.job_ids).size !== batch.job_ids.length ||
    batch.job_ids.some((id) => !/^[a-f0-9-]{36}$/.test(id))
  )
    throw new Error('Invalid batch membership.');
  const root = dirname(dirname(batchPath));
  const count = (proposals, humanCount) => {
    const dispositions = {};
    for (const p of proposals) dispositions[p.disposition] = (dispositions[p.disposition] ?? 0) + 1;
    return {
      proposals: proposals.length,
      non_mapped_proposals: proposals.filter((p) => p.disposition !== 'mapped').length,
      automatic_retained_evidence: proposals.filter(automaticEvidenceClassificationValid).length,
      dispositions,
      human_dispositions:
        humanCount ??
        proposals.filter(
          (p) =>
            !p.derivation && p.disposition !== 'mapped' && !automaticEvidenceClassificationValid(p),
        ).length,
      source_label_targets: proposals.filter((p) => p.target.startsWith('source_label:')).length,
    };
  };
  const products = [];
  for (const id of batch.job_ids) {
    const job = load(join(root, 'jobs', `${id}.json`)),
      p = job.preparation;
    if (
      job.approval ||
      job.finalization_request ||
      job.final_result ||
      p?.bridge?.reviewed_semantic_decisions?.length
    )
      throw new Error('Pressure evidence must contain no human authority actions.');
    const row = {
      id,
      manufacturer: job.intake.manufacturer,
      model: job.intake.product_model,
      state: job.state,
      qualified_facts: p?.qualified_facts?.length ?? 0,
      retained_extractions: p?.document_extractions?.length ?? 0,
      // Empty qualification is a pipeline observation, never an assertion that
      // the requested product lacks specifications. Raw bytes are unavailable.
      zero_qf_stage:
        p?.status !== 'review_ready'
          ? 'acquisition_limitation'
          : !p.qualified_facts.length
            ? 'extraction_qualification_or_applicability'
            : null,
      reconciliation: p?.reconciliation
        ? {
            groups: p.reconciliation.groups.length,
            outcomes: p.reconciliation.group_reconciliations.reduce((counts, r) => {
              counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
              return counts;
            }, {}),
          }
        : null,
      before: count(p?.proposals ?? []),
    };
    if (p?.status !== 'review_ready') {
      products.push({
        ...row,
        after: row.before,
        remaining: [{ category: 'acquisition_limitation', count: 1 }],
      });
      continue;
    }
    const input = {
      facts: p.qualified_facts,
      source_acquisitions: p.source_acquisitions,
      reconciliation: reconcileQualifiedFactsForWholeIntake({
        facts: p.qualified_facts,
        source_acquisitions: p.source_acquisitions,
      }),
    };
    if (artifactDigest(input.reconciliation) !== artifactDigest(p.reconciliation))
      throw new Error('Source-native F replay changed.');
    const proposals = buildProductionSemanticProposals(input, interpreter);
    if (
      artifactDigest(proposals) !==
      artifactDigest(buildProductionSemanticProposals(input, interpreter))
    )
      throw new Error('Non-deterministic semantic replay.');
    const bridge = buildProductionProductCandidate({
      ...input,
      intake: job.intake,
      captures: p.captures,
      proposals,
    });
    const replay = buildProductionProductCandidate({
      ...input,
      intake: job.intake,
      captures: p.captures,
      proposals,
    });
    if (artifactDigest(bridge) !== artifactDigest(replay))
      throw new Error('Non-deterministic candidate replay.');
    const completion = evaluateSemanticReviewCompletion(
      proposals,
      bridge.reviewed_semantic_interpretation,
    );
    const remaining = proposals
      .filter((p) => !p.derivation && p.disposition !== 'mapped')
      .map((proposal) =>
        classifyPressureProposal(proposal, p.qualified_facts, bridge.non_projected),
      );
    const allRows = proposals.map((proposal) => ({
      ...classifyPressureProposal(proposal, p.qualified_facts, bridge.non_projected),
      projected: bridge.projected_proposal_ids.includes(proposal.id),
      derivation: proposal.derivation ?? null,
    }));
    const target = {
      product_model: job.intake.product_model,
      manufacturer_part_number: job.intake.manufacturer_part_number,
    };
    const qualificationReplay = p.document_extractions.map((doc) =>
      qualifyDocumentExtraction(doc, target),
    );
    products.push({
      ...row,
      after: count(proposals, completion.required_dispositions.length),
      all_proposal_rows: allRows,
      legacy_untyped_context_facts: p.qualified_facts.filter((f) =>
        f.evidence?.some((e) => e.role === 'context' && !e.context),
      ).length,
      typed_context_facts: p.qualified_facts.filter((f) => f.evidence?.some((e) => e.context))
        .length,
      required_dispositions: completion.required_dispositions.length,
      projected: bridge.projected_proposal_ids.length,
      candidate: bridge.candidate?.id ?? null,
      projection_diagnostics: bridge.non_projected,
      qualification_replay_facts: qualificationReplay.reduce((n, r) => n + r.facts.length, 0),
      qualification_diagnostics: qualificationReplay.flatMap((r) =>
        r.diagnostics.map((d) => d.code),
      ),
      mapped: proposals
        .filter((p) => p.disposition === 'mapped')
        .map((p) => ({
          id: p.id,
          target: p.target,
          qualified_value: p.qualified_value ?? null,
          semantic_assertions: p.semantic_assertions ?? null,
          projected: bridge.projected_proposal_ids.includes(p.id),
        })),
      remaining,
    });
  }
  for (const [path, before] of hashes)
    if (sha(readFileSync(path)) !== before)
      throw new Error('Copied evidence changed during replay.');
  const total = (phase) =>
    products.reduce(
      (acc, p) => {
        acc.proposals += p[phase].proposals;
        acc.non_mapped_proposals += p[phase].non_mapped_proposals;
        acc.automatic_retained_evidence += p[phase].automatic_retained_evidence;
        acc.human_dispositions += p[phase].human_dispositions;
        acc.source_label_targets += p[phase].source_label_targets;
        for (const [k, v] of Object.entries(p[phase].dispositions))
          acc.dispositions[k] = (acc.dispositions[k] ?? 0) + v;
        return acc;
      },
      {
        proposals: 0,
        non_mapped_proposals: 0,
        automatic_retained_evidence: 0,
        human_dispositions: 0,
        source_label_targets: 0,
        dispositions: {},
      },
    );
  const remaining_proposal_table = products.flatMap((p) =>
    p.remaining
      .filter((r) => r.proposal_id)
      .map((r) => ({ job_id: p.id, manufacturer: p.manufacturer, product_model: p.model, ...r })),
  );
  // Group every non-mapped observation by its actual diagnostic and rule identity;
  // counts retain exact proposal/job membership so grouping cannot hide workload.
  const groups = new Map();
  for (const row of remaining_proposal_table) {
    const identity = {
      labels: row.normalized_source_labels,
      target: row.target,
      category: row.category,
      workload_category: row.workload_category,
      rules: row.recognized.map((r) => `${r.rule_id}@${r.rule_revision}:${r.interpreter}`),
      retained_rules:
        row.automatic_evidence_classification?.assertions.map(
          (a) => `${a.rule.id}@${a.rule.revision}`,
        ) ?? [],
      reasons: row.review_required_reasons,
    };
    const key = JSON.stringify(identity);
    const group = groups.get(key) ?? {
      ...identity,
      count: 0,
      human_count: 0,
      proposal_ids: [],
      job_ids: [],
    };
    group.count++;
    group.human_count += Number(row.requires_human_semantic_disposition);
    group.proposal_ids.push(row.proposal_id);
    if (!group.job_ids.includes(row.job_id)) group.job_ids.push(row.job_id);
    groups.set(key, group);
  }
  const report = {
    policy: 'offline-pressure-replay.v3',
    semantic_interpreter: interpreter,
    batch_id: batch.id,
    jobs: products.length,
    facts: products.reduce((n, p) => n + p.qualified_facts, 0),
    before: total('before'),
    after: total('after'),
    deterministic: true,
    copied_evidence_unchanged: true,
    authority_actions: 0,
    products,
    remaining_proposal_table,
    complete_grouped_remaining_table: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value),
    stage_limitation_table: products
      .filter((p) => p.zero_qf_stage)
      .map((p) => ({
        job_id: p.id,
        manufacturer: p.manufacturer,
        product_model: p.model,
        category: p.zero_qf_stage,
        qualified_facts: p.qualified_facts,
      })),
    remaining_human_review_table: remaining_proposal_table.filter(
      (r) => r.requires_human_semantic_disposition,
    ),
    automatic_retained_evidence_table: remaining_proposal_table.filter(
      (r) => r.category === 'automatic_retained_non_authoritative_evidence',
    ),
    complete_mapped_rule_table: products.flatMap((p) =>
      (p.all_proposal_rows ?? [])
        .filter((r) => r.disposition === 'mapped')
        .map((r) => ({ job_id: p.id, manufacturer: p.manufacturer, product_model: p.model, ...r })),
    ),
    remaining_category_counts: remaining_proposal_table.reduce((counts, r) => {
      counts[r.category] = (counts[r.category] ?? 0) + 1;
      return counts;
    }, {}),
    human_workload_category_counts: remaining_proposal_table
      .filter((r) => r.requires_human_semantic_disposition)
      .reduce((counts, r) => {
        counts[r.workload_category] = (counts[r.workload_category] ?? 0) + 1;
        return counts;
      }, {}),
    reviewed_schema_model_gaps: {
      count: 0,
      reason:
        'No reviewed semantic decisions exist in this frozen pressure input; unrecognized vocabulary is not schema-gap evidence.',
    },
  };
  // Historical reports are explicit TEMP diagnostic inputs, never authority.
  // No default filesystem discovery or fallback to original job writes exists.
  report.historical_comparisons = { frozen_baseline: report.before };
  if (historicalPaths)
    for (const [name, path] of Object.entries(historicalPaths)) {
      insideTemp(resolve(path));
      insideTemp(realpathSync(path));
      const bytes = readFileSync(path),
        old = JSON.parse(bytes);
      if (
        old.batch_id !== batch.id ||
        old.jobs !== report.jobs ||
        old.facts !== report.facts ||
        old.authority_actions !== 0
      )
        throw new Error('Historical pressure report does not match this frozen corpus.');
      report.historical_comparisons[name] = {
        metrics: old.after,
        report_digest: sha(bytes),
        path: resolve(path),
      };
    }
  report.historical_comparisons.context_typed_workload_closure = report.after;
  // A report is a new TEMP artifact, never an overwrite target. This also rejects
  // an existing symlink at the output filename rather than following it.
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = args.at(-1)?.startsWith('--interpreter=') ? args.pop() : undefined;
  const interpreter = option?.slice('--interpreter='.length) ?? SEMANTIC_RULE_INTERPRETER;
  if (![2, 4].includes(args.length))
    throw new Error(
      'Usage: node scripts/ingestion-pressure-replay.mjs TEMP/batches/id.json TEMP/report.json [TEMP/unsafe.json TEMP/corrected-v2.json] [--interpreter=semantic-assertions.v3]',
    );
  const report = replayPressureCorpus(
    args[0],
    args[1],
    args.length === 4 ? { pre_correction_unsafe: args[2], corrected_v2: args[3] } : undefined,
    interpreter,
  );
  console.log(
    JSON.stringify(
      {
        jobs: report.jobs,
        facts: report.facts,
        before: report.before,
        after: report.after,
        deterministic: report.deterministic,
        copied_evidence_unchanged: report.copied_evidence_unchanged,
        authority_actions: report.authority_actions,
      },
      null,
      2,
    ),
  );
}
