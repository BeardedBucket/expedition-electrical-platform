import type { IngestionJob } from '@expedition/ingestion-runtime';
import type { ArtifactReference, CanonicalQualifiedValue } from '@expedition/ingestion';
import { artifactDigest, canonicalIdFor } from '@expedition/ingestion';
import { productRoles } from './product-review.js';

const valueAt = (data: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      data,
    );
const safeUri = (uri: string | undefined) => (uri && /^https?:\/\//i.test(uri) ? uri : undefined);
const operatorIssues = (issues: readonly { code: string; path: string; message: string }[]) =>
  issues.slice(0, 100).map(({ code, path, message }) => ({
    code,
    path,
    message: ['write_failed', 'promotion_already_exists'].includes(code)
      ? code === 'write_failed'
        ? 'Unable to create canonical component; inspect local service diagnostics.'
        : 'Canonical component already exists. No overwrite was performed.'
      : message,
  }));

export function productReviewView(job: IngestionJob) {
  const p = job.preparation;
  if (p?.status !== 'review_ready') return undefined;
  const proposalViews = (field: string, qualifiedId?: string) =>
    p.proposals
      .filter(
        (proposal) =>
          proposal.target === field &&
          (qualifiedId ? proposal.qualified_value?.id === qualifiedId : !proposal.qualified_value),
      )
      .slice(0, 500)
      .map((proposal) => ({
        id: proposal.id,
        disposition: proposal.disposition,
        value: proposal.proposed_value,
        projected: p.bridge.projected_proposal_ids.includes(proposal.id),
        references: [...proposal.evidence_refs, ...(proposal.fact_refs ?? [])].map(reference),
        evidence: p.qualified_facts
          .filter((fact) => proposal.fact_refs?.some((ref) => ref.digest === artifactDigest(fact)))
          .slice(0, 1000)
          .map((fact) => {
            const capture = p.captures.find(
              (capture) => artifactDigest(capture) === fact.source_capture.digest,
            );
            const document = p.document_extractions.find(
              (document) => fact.document_extraction?.digest === artifactDigest(document),
            );
            return {
              id: fact.id,
              label: fact.metadata.source_label,
              raw_value: fact.metadata.raw_value,
              unit: fact.metadata.source_unit,
              applicability: fact.metadata.applicability,
              qualification: fact.qualification_state,
              source_uri: safeUri(capture?.final_uri ?? capture?.requested_uri),
              document: document?.title,
              locators: fact.evidence?.map(({ role, locator, block_id }) => ({
                role,
                locator,
                block_id,
              })),
              conflicts: p.reconciliation.group_reconciliations
                .filter(
                  (group) =>
                    group.qualified_fact_ids.includes(fact.id) &&
                    (group.outcome === 'conflict' || group.outcome === 'unresolved'),
                )
                .map((group) => ({ id: group.id, outcome: group.outcome })),
            };
          }),
      }));
  const assertions = p.bridge.candidate?.component_data.qualified_values as
    CanonicalQualifiedValue[] | undefined;
  const fields = [
    ...new Set(
      p.proposals
        .filter((proposal) => !proposal.qualified_value)
        .map((proposal) => proposal.target),
    ),
  ];
  return {
    roles: productRoles,
    canonical_id: p.bridge.candidate ? canonicalIdFor(p.bridge.candidate) : undefined,
    truncated:
      (assertions?.length ?? 0) > 200 ||
      fields.length > 200 ||
      p.proposals.length > 500 ||
      p.qualified_facts.length > 1000,
    fields: fields.slice(0, 200).map((field) => ({
      path: field,
      value: valueAt(p.bridge.candidate?.component_data, field),
      selectable: !!p.bridge.candidate?.field_evidence[field],
      candidate_fact_ids: p.bridge.candidate?.field_evidence[field] ?? [],
      proposals: proposalViews(field),
    })),
    qualified_values: (assertions ?? []).slice(0, 200).map((assertion) => ({
      id: assertion.id,
      target: assertion.target,
      value: assertion.value,
      qualifiers: assertion.qualifiers,
      candidate_fact_ids: p.bridge.candidate?.qualified_value_evidence?.[assertion.id] ?? [],
      proposals: proposalViews(assertion.target, assertion.id),
    })),
    candidate_facts: p.bridge.facts
      .slice(0, 1000)
      .map(({ id, field, raw_label, raw_value, fact_state }) => ({
        id,
        field,
        raw_label,
        raw_value,
        fact_state,
      })),
    topology_evidence: p.bridge.candidate?.topology_evidence,
  };
}

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
  const acceptedResolution =
    job.accepted_source_resolution?.kind === 'source_resolution'
      ? job.source_resolution_attempts?.find(
          ({ resolution }) =>
            resolution.disposition === 'accepted' &&
            artifactDigest(resolution) === job.accepted_source_resolution?.digest,
        )?.resolution
      : undefined;
  return {
    summary: jobSummary(job),
    product_review: productReviewView(job),
    approval: job.approval
      ? {
          decision: job.approval.decision,
          reviewer_label: job.approval.reviewer_id,
          reviewed_at: job.approval.reviewed_at,
          reviewed_decisions: job.approval.reviewed_decisions,
          promotion_decisions: job.approval.promotion_decisions,
          review_package: reference(job.approval.review_package),
          review_package_snapshot: job.approval.review_package_snapshot,
          semantic_snapshot: job.approval.semantic_snapshot,
        }
      : undefined,
    finalization: job.finalization_request
      ? {
          requested_at: job.finalization_request.requested_at,
          write_authorized: job.finalization_request.write_request.write === true,
          promotion_status: job.final_result?.promotion.result.status,
          write_status: job.final_result?.write_result.status,
          collision: job.final_result?.write_result.collision,
          schema_valid: job.final_result?.write_result.schema_valid,
          promotion_issues: operatorIssues(job.final_result?.promotion.result.issues ?? []),
          write_issues: operatorIssues(job.final_result?.write_result.issues ?? []),
        }
      : undefined,
    source_resolution: !job.intake.official_product_uri
      ? {
          state: job.state,
          requested_identity: {
            manufacturer: job.intake.manufacturer,
            product_model: job.intake.product_model,
            manufacturer_part_number: job.intake.manufacturer_part_number,
          },
          accepted_reference: job.accepted_source_resolution
            ? reference(job.accepted_source_resolution)
            : undefined,
          accepted_uri: acceptedResolution?.final_uri,
          attempt_count: job.source_resolution_attempts?.length ?? 0,
          history_truncated: (job.source_resolution_attempts?.length ?? 0) > 50,
          attempts: (job.source_resolution_attempts ?? [])
            .slice(-50)
            .map(({ resolution: r, capture: c }) => ({
              attempt_id: r.attempt_id,
              candidate_uri: r.candidate_uri,
              normalized_uri: r.normalized_uri,
              final_uri: r.final_uri,
              discovery_method: r.discovery_method,
              domain_evidence: r.domain_evidence,
              title: r.title,
              observations: r.observations.slice(0, 30),
              diagnostics: r.diagnostics.slice(0, 30).map(({ code, message }) => ({
                code,
                message: code.startsWith('snapshot_')
                  ? 'Snapshot operation failed; inspect local service diagnostics.'
                  : message,
              })),
              disposition: r.disposition,
              review: r.review,
              captured_at: r.captured_at,
              capture: {
                reference: reference(r.capture),
                disposition: c.disposition,
                content_digest: c.content_digest,
                media_type: c.media_type,
                response_status: c.response_status,
                reason_codes: c.reason_codes,
                redirects: c.redirect_chain
                  ?.slice(0, 5)
                  .map(({ requested_uri, destination_uri, response_status }) => ({
                    requested_uri,
                    destination_uri,
                    response_status,
                  })),
              },
              can_accept:
                r.disposition === 'pending' && c.disposition === 'authoritative' && !!r.final_uri,
            })),
        }
      : undefined,
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
      ...(job.error
        ? [
            {
              code: `${job.error.operation}_failed`,
              message:
                job.error.operation === 'finalize'
                  ? 'Finalization failed. Inspect local service diagnostics; this job cannot be retried.'
                  : job.error.message,
            },
          ]
        : []),
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
export type OperatorJobDetail = Omit<
  ReturnType<typeof jobDetail>,
  'product_review' | 'approval' | 'finalization'
> &
  Partial<Pick<ReturnType<typeof jobDetail>, 'product_review' | 'approval' | 'finalization'>>;
