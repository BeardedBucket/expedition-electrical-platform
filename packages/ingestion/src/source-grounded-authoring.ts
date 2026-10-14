import { createHash } from 'node:crypto';
import {
  parseSourceGroundedDraft,
  type SourceGroundedDraft,
} from '@expedition/engineering-core/source-grounded-draft';
import { artifactDigest } from './production-contracts.js';
import type { ProductionIngestWorkflowResult } from './production-ingest-workflow.js';

export interface AuthoredSourceProof {
  source_id: string;
  locator: string;
  context_digest: string;
  start_byte: number;
  end_byte: number;
}
export interface AuthoredDraftProposal {
  version: 'authored-draft-proposal.v1';
  draft: SourceGroundedDraft;
  proofs: AuthoredSourceProof[];
}
export interface AuthoredDraftImport {
  version: 'authored-draft-import.v1';
  proposal: AuthoredDraftProposal;
  proposal_digest: string;
  preparation_digest: string;
  base_job_version: string;
  recorded_at: string;
  authority: 'codex_prepared_unreviewed';
  /** Owned private snapshots keep history replayable after source/semantic recovery. */
  supporting_preparations: ProductionIngestWorkflowResult[];
}
const closed = (raw: unknown, keys: string[]) => {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !keys.includes(k))
  )
    throw Error('Invalid authored proposal member');
};
const bytesDigest = (bytes: Uint8Array) =>
  'sha256:' + createHash('sha256').update(bytes).digest('hex');

/** Bind proposals to original acquisition bytes, even when zero facts were
 * extracted. A byte hash proves source/context identity, not the correctness of
 * the author's model-column interpretation. Whole PDF context is intentionally
 * permitted: human review uses its page/table locator, not an invented excerpt.
 * Source accessibility does not imply redistribution; proposal contains no body. */
export function validateAuthoredDraftProposal(
  raw: unknown,
  preparation: ProductionIngestWorkflowResult,
  supporting: readonly ProductionIngestWorkflowResult[] = [],
): AuthoredDraftProposal {
  closed(raw, ['version', 'draft', 'proofs']);
  const p = raw as AuthoredDraftProposal;
  if (p.version !== 'authored-draft-proposal.v1' || !Array.isArray(p.proofs))
    throw Error('Unsupported authored proposal');
  const draft = parseSourceGroundedDraft(p.draft);
  if (
    draft.product.model !== preparation.intake.product_model ||
    draft.product.manufacturer !== preparation.intake.manufacturer ||
    (preparation.intake.manufacturer_part_number !== undefined &&
      draft.product.manufacturer_part_number !== preparation.intake.manufacturer_part_number)
  )
    throw Error('Foreign authored product identity');
  const preparations = [preparation, ...supporting];
  if (
    preparations.some(
      (p) =>
        p.intake.manufacturer !== draft.product.manufacturer ||
        p.intake.product_model !== draft.product.model,
    )
  )
    throw Error('Foreign supporting source job');
  const captures = preparations.flatMap((p) => [
    p.acquisition.seed_capture,
    ...p.acquisition.candidates.flatMap((c) => (c.capture ? [c.capture] : [])),
  ]);
  const sourceBytes = new Map<string, Uint8Array>();
  for (const s of draft.sources) {
    const c = captures.find(
      (c) =>
        c.artifact.content_digest === s.content_digest &&
        c.artifact.final_uri === s.url &&
        c.artifact.retrieved_at === s.retrieved_at,
    );
    if (
      !c?.source?.body.bytes ||
      c.disposition !== 'authoritative' ||
      c.artifact.retention_status !== 'retained' ||
      !c.artifact.snapshot ||
      bytesDigest(c.source.body.bytes) !== s.content_digest
    )
      throw Error('Missing original retained source bytes/identity');
    sourceBytes.set(s.id, c.source.body.bytes);
  }
  const proofIds = new Set<string>();
  // Repeated whole-document locators share byte identity, not semantic meaning.
  // Cache byte-region hashes only within this validation call; no mutable global
  // state or cross-source reuse can turn a changed body into an accepted proof.
  const regions = new Map<string, string>();
  for (const proof of p.proofs) {
    closed(proof, ['source_id', 'locator', 'context_digest', 'start_byte', 'end_byte']);
    const bytes = sourceBytes.get(proof.source_id);
    const id = JSON.stringify([proof.source_id, proof.locator, proof.context_digest]);
    // Direct-authoring context is the complete retained document. Page/column
    // locators navigate that context; they never license a field-only crop.
    if (proofIds.has(id) || !bytes || proof.start_byte !== 0 || proof.end_byte !== bytes.length)
      throw Error('Foreign, cropped or tampered source context proof');
    const region = JSON.stringify([proof.source_id, proof.start_byte, proof.end_byte]);
    const digest =
      regions.get(region) ?? bytesDigest(bytes.subarray(proof.start_byte, proof.end_byte));
    regions.set(region, digest);
    if (digest !== proof.context_digest)
      throw Error('Foreign, cropped or tampered source context proof');
    proofIds.add(id);
  }
  if (
    draft.facts.some(
      (f) => !proofIds.has(JSON.stringify([f.source_id, f.locator, f.context_digest])),
    )
  )
    throw Error('Missing authored fact proof');
  if (
    p.proofs.some(
      (proof) =>
        !draft.facts.some(
          (f) =>
            f.source_id === proof.source_id &&
            f.locator === proof.locator &&
            f.context_digest === proof.context_digest,
        ),
    )
  )
    throw Error('Unused source proof');
  return JSON.parse(JSON.stringify({ ...p, draft })) as AuthoredDraftProposal;
}
export function validateAuthoredImports(
  imports: readonly AuthoredDraftImport[],
  preparations: readonly ProductionIngestWorkflowResult[],
) {
  if (
    !Array.isArray(imports) ||
    new Set(imports.map((i) => i.proposal_digest)).size !== imports.length
  )
    throw Error('Duplicate/invalid authored history');
  for (const i of imports) {
    closed(i, [
      'version',
      'proposal',
      'proposal_digest',
      'preparation_digest',
      'base_job_version',
      'recorded_at',
      'authority',
      'supporting_preparations',
    ]);
    if (!Array.isArray(i.supporting_preparations))
      throw Error('Missing owned source preparation snapshots');
    const p = [...preparations, ...i.supporting_preparations].find(
      (p) => artifactDigest(p) === i.preparation_digest,
    );
    if (
      !p ||
      !/^[a-f0-9]{64}$/.test(i.base_job_version) ||
      i.version !== 'authored-draft-import.v1' ||
      i.authority !== 'codex_prepared_unreviewed' ||
      !Number.isFinite(Date.parse(i.recorded_at)) ||
      artifactDigest(validateAuthoredDraftProposal(i.proposal, p, i.supporting_preparations)) !==
        i.proposal_digest
    )
      throw Error('Invalid authored history binding');
  }
}
