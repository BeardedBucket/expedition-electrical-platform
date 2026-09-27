import type { IngestionJob } from '@expedition/ingestion-runtime';
import type { ArtifactReference } from '@expedition/ingestion';

// Allowlisted reference metadata only; no internal provenance or captured bodies.
const reference = (ref: ArtifactReference) => ({
  kind: ref.kind,
  reference: ref.reference,
  reference_schema_version: ref.reference_schema_version,
  digest: ref.digest,
  digest_algorithm: ref.digest_algorithm,
});

export const jobSummary = (job: IngestionJob) => {
  const prepared = job.preparation;
  const review = prepared?.status === 'review_ready' ? prepared : undefined;
  return {
    id: job.id,
    created_at: job.created_at,
    updated_at: job.updated_at,
    state: job.state,
    manufacturer: job.intake.manufacturer,
    product_model: job.intake.product_model,
    manufacturer_part_number: job.intake.manufacturer_part_number,
    official_product_uri: job.intake.official_product_uri,
    preparation_status: prepared?.status,
    candidate_present: review ? review.bridge.candidate !== undefined : undefined,
    fact_count: prepared?.qualified_facts.length,
    proposal_count: review?.proposals.length,
    unresolved_count: review?.reconciliation.unresolved_count,
    conflict_count: review?.reconciliation.conflict_count,
    final_result_status: job.final_result?.promotion.result.status,
    write_status: job.final_result?.write_result.status,
  };
};

export const jobDetail = (job: IngestionJob) => {
  const p = job.preparation;
  const r = p?.status === 'review_ready' ? p : undefined;
  const candidate = r?.bridge.candidate;
  const pkg = r?.review_package;
  return {
    summary: jobSummary(job),
    intake: {
      manufacturer: job.intake.manufacturer,
      product_model: job.intake.product_model,
      manufacturer_part_number: job.intake.manufacturer_part_number,
      official_product_uri: job.intake.official_product_uri,
    },
    acquisition: p
      ? {
          status: p.acquisition.status,
          issues: p.acquisition.issues,
          candidate_count: p.acquisition.candidates.length,
          selected_count: p.acquisition.candidates.filter(
            (c) => c.candidate.selection_status === 'selected',
          ).length,
          captured_count: p.captures.length,
          duplicate_count: p.acquisition.candidates.filter(
            (c) => c.candidate.selection_status === 'duplicate_uri',
          ).length,
          excluded_by_policy_count: p.acquisition.candidates.filter(
            (c) => c.candidate.selection_status === 'excluded_by_policy',
          ).length,
        }
      : undefined,
    sources: p
      ? [
          {
            id: p.acquisition.seed_capture.artifact.id,
            label: 'Intake product page',
            uri:
              p.acquisition.seed_capture.artifact.final_uri ??
              p.acquisition.seed_capture.artifact.requested_uri,
            role: 'product_page',
            officiality: p.acquisition.artifact?.officiality,
            selection: 'seed',
            capture_outcome: p.acquisition.seed_capture.disposition,
            capture_disposition: p.acquisition.seed_capture.disposition,
            media_type: p.acquisition.seed_capture.artifact.media_type,
            parent_uri: undefined as string | undefined,
            duplicate_of: undefined as string | undefined,
            equivalent_content_of: undefined as string | undefined,
            reason_codes: p.acquisition.seed_capture.artifact.reason_codes,
          },
          ...p.acquisition.candidates.map(({ candidate: c, capture }) => ({
            id: c.id,
            label: c.discovery.source_label,
            uri: capture?.artifact.final_uri ?? c.normalized_uri,
            role: c.role,
            officiality: c.officiality,
            selection: c.selection_status,
            capture_outcome: c.capture_outcome,
            capture_disposition: c.capture_disposition,
            media_type: capture?.artifact.media_type,
            parent_uri: c.discovery.parent_uri,
            duplicate_of: c.duplicate_of_candidate_id,
            equivalent_content_of: c.equivalent_content_of_candidate_id,
            reason_codes: c.capture_reason_codes,
          })),
        ]
      : undefined,
    extractions: p?.document_extractions.map((e, index) => ({
      id: e.id,
      source_capture: reference(e.source_capture),
      acquisition_candidate_id: e.acquisition_candidate_id,
      status: e.status,
      capability: e.capability_state,
      remediation: e.remediation_state,
      page_count: e.page_count,
      block_count: e.blocks.length,
      table_count: e.blocks.filter((b) => b.kind === 'table').length,
      diagnostics: e.diagnostics?.map((d) => ({ code: d.code, message: d.message })),
      // The pipeline appends exactly one qualification per extraction, in order.
      qualification: p.qualifications[index]
        ? {
            status: p.qualifications[index].outcome,
            completeness: p.qualifications[index].completeness,
            fact_count: p.qualifications[index].facts.length,
            diagnostics: p.qualifications[index].diagnostics.map((d) => ({
              code: d.code,
              message: d.message,
            })),
          }
        : undefined,
    })),
    facts: p?.qualified_facts.map((f) => ({
      id: f.id,
      source_label: f.metadata.source_label,
      raw_value: f.metadata.raw_value,
      source_unit: f.metadata.source_unit,
      applicability: {
        kind: f.metadata.applicability.kind,
        value: f.metadata.applicability.value,
        reason: f.metadata.applicability.reason,
      },
      qualification_state: f.qualification_state,
      source_reference: reference(f.source_capture),
    })),
    reconciliation: r
      ? {
          id: r.reconciliation.id,
          agreement_count: r.reconciliation.agreement_count,
          conflict_count: r.reconciliation.conflict_count,
          unresolved_count: r.reconciliation.unresolved_count,
          unscoped_fact_ids: r.reconciliation.unscoped_qualified_fact_ids,
          scope_inconsistent_fact_ids: r.reconciliation.scope_inconsistent_qualified_fact_ids,
          label_unavailable_fact_ids: r.reconciliation.label_unavailable_qualified_fact_ids,
          groups: r.reconciliation.group_reconciliations.map((g) => ({
            id: g.id,
            comparison_group_id: g.comparison_group_id,
            outcome: g.outcome,
            fact_ids: g.qualified_fact_ids,
            unresolved_fact_ids: g.unresolved_qualified_fact_ids,
          })),
        }
      : undefined,
    proposals: r?.proposals.map((s) => ({
      id: s.id,
      target: s.target,
      disposition: s.disposition,
      proposed_value: s.proposed_value,
      evidence_refs: s.evidence_refs.map(reference),
      fact_refs: s.fact_refs?.map(reference),
    })),
    candidate: r
      ? {
          present: candidate !== undefined,
          id: candidate?.id,
          projected_fields: candidate?.component_data,
          field_evidence: candidate?.field_evidence,
          non_projected: r.bridge.non_projected.map((d) => ({
            proposal_id: d.proposal_id,
            reason: d.reason,
          })),
        }
      : undefined,
    review_package: pkg
      ? {
          id: pkg.id,
          candidate_present: pkg.candidate !== undefined,
          source_reference_count: pkg.source_refs.length,
          fact_reference_count: pkg.fact_refs.length,
          proposal_reference_count: pkg.proposal_refs.length,
          unresolved_count: pkg.unresolved_items?.length,
          conflict_count: pkg.conflicts?.length,
          unresolved_items: pkg.unresolved_items,
          conflicts: pkg.conflicts,
          semantic_snapshot: pkg.semantic_snapshot,
        }
      : undefined,
    diagnostics: [
      ...(job.error ? [{ code: `${job.error.operation}_failed`, message: job.error.message }] : []),
      ...(p?.status === 'preparation_failed'
        ? [
            {
              code: p.reason,
              message: `Preparation failed: ${p.reason}. Inspect source and extraction diagnostics.`,
            },
          ]
        : []),
    ],
  };
};

// These types are imported with `import type` by the browser. The projection is Node-only.
export type OperatorJobSummary = ReturnType<typeof jobSummary>;
export type OperatorJobDetail = ReturnType<typeof jobDetail>;
