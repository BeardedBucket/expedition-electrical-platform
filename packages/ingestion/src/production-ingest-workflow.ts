import type { SourceCaptureAdapter } from './capture-types.js';
import { extractDocumentAsync } from './document-extraction.js';
import {
  artifactReference,
  buildDocumentExtractionArtifact,
  qualifyDocumentExtraction,
  validateProductIntake,
  type DocumentExtractionArtifact,
  type DocumentQualificationResult,
  type ProductIntake,
  type QualifiedFactArtifact,
  type ReviewPackage,
  type SemanticProposal,
  type SourceAcquisitionArtifact,
  type SourceCaptureArtifact,
  type SourceAcquisitionCandidate,
} from './production-contracts.js';
import {
  acquireOfficialSources,
  type SourceAcquisitionRequest,
  type SourceAcquisitionResult,
} from './source-acquisition.js';
import {
  reconcileQualifiedFactsForWholeIntake,
  type QualifiedFactWholeIntakeReconciliationResult,
} from './reconciliation.js';
import { buildProductionSemanticProposals } from './production-semantic-bridge.js';
import {
  buildProductionProductCandidate,
  type ProductionCandidateBridgeResult,
} from './production-candidate-bridge.js';
import { buildProductionReviewPackage } from './production-review-package.js';

export interface ProductionIngestWorkflowRequest {
  readonly intake: ProductIntake;
  readonly adapter: SourceCaptureAdapter;
  readonly profiles?: SourceAcquisitionRequest['profiles'];
  readonly profile?: SourceAcquisitionRequest['profile'];
  readonly policy?: SourceAcquisitionRequest['policy'];
  readonly expected_content?: SourceAcquisitionRequest['expected_content'];
}

export type ProductionIngestWorkflowResult =
  | {
      readonly status: 'review_ready';
      readonly intake: ProductIntake;
      readonly acquisition: SourceAcquisitionResult;
      readonly source_acquisitions: readonly SourceAcquisitionArtifact[];
      readonly captures: readonly SourceCaptureArtifact[];
      readonly document_extractions: readonly DocumentExtractionArtifact[];
      readonly qualifications: readonly DocumentQualificationResult[];
      readonly qualified_facts: readonly QualifiedFactArtifact[];
      readonly reconciliation: QualifiedFactWholeIntakeReconciliationResult;
      readonly proposals: readonly SemanticProposal[];
      readonly bridge: ProductionCandidateBridgeResult;
      readonly review_package: ReviewPackage;
    }
  | {
      readonly status: 'preparation_failed';
      readonly intake: ProductIntake;
      readonly acquisition: SourceAcquisitionResult;
      readonly source_acquisitions: readonly SourceAcquisitionArtifact[];
      readonly captures: readonly SourceCaptureArtifact[];
      readonly document_extractions: readonly DocumentExtractionArtifact[];
      readonly qualifications: readonly DocumentQualificationResult[];
      readonly qualified_facts: readonly QualifiedFactArtifact[];
      readonly reason: 'acquisition_failed' | 'extraction_failed';
    };

/** Prepare production evidence for human review without recording a decision or writing a corpus. */
export const prepareProductionIngestReview = async (
  request: ProductionIngestWorkflowRequest,
): Promise<ProductionIngestWorkflowResult> => {
  const intakeIssues = validateProductIntake(request.intake);
  if (intakeIssues.length) throw new Error(`Invalid product intake: ${intakeIssues.join('; ')}`);

  if (!request.intake.official_product_uri)
    throw new Error(
      'Official source resolution required: supply a verified official product URI before preparation.',
    );
  const acquisition = await acquireOfficialSources(request);
  const source_acquisitions = acquisition.artifact ? [acquisition.artifact] : [];
  const captured = [
    acquisition.seed_capture,
    ...acquisition.candidates.flatMap((item) => (item.capture ? [item.capture] : [])),
  ];
  const captures = captured.map((item) => item.artifact);
  const document_extractions: DocumentExtractionArtifact[] = [];
  const qualifications: DocumentQualificationResult[] = [];
  const qualified_facts: QualifiedFactArtifact[] = [];
  const common = {
    intake: request.intake,
    acquisition,
    source_acquisitions,
    captures,
    document_extractions,
    qualifications,
    qualified_facts,
  };

  if (
    !acquisition.artifact ||
    acquisition.seed_capture.disposition !== 'authoritative' ||
    acquisition.artifact.officiality !== 'official'
  ) {
    return { status: 'preparation_failed', reason: 'acquisition_failed', ...common };
  }

  const acquisitionReference = artifactReference('source_acquisition', acquisition.artifact);
  const extractable: {
    readonly capture?: SourceAcquisitionResult['seed_capture'];
    readonly candidateId?: string;
    readonly candidate?: SourceAcquisitionCandidate;
  }[] = [
    { capture: acquisition.seed_capture, candidateId: undefined },
    ...acquisition.candidates.map((item) => ({
      capture: item.capture,
      candidateId: item.candidate.id,
      candidate: item.candidate,
    })),
  ];
  for (const item of extractable) {
    if (!item.capture?.source || item.capture.disposition !== 'authoritative') continue;
    if (
      item.candidate &&
      (item.candidate.officiality !== 'official' ||
        item.candidate.capture_outcome !== 'authoritative')
    )
      continue;
    const document = await extractDocumentAsync(item.capture.source);
    const extraction = buildDocumentExtractionArtifact(
      document,
      artifactReference('source_capture', item.capture.artifact),
      {
        source_acquisition: acquisitionReference,
        ...(item.candidateId ? { acquisition_candidate_id: item.candidateId } : {}),
      },
    );
    document_extractions.push(extraction);
    const qualification = qualifyDocumentExtraction(extraction, {
      ...(request.intake.manufacturer_part_number
        ? { manufacturer_part_number: request.intake.manufacturer_part_number }
        : {}),
      product_model: request.intake.product_model,
    });
    qualifications.push(qualification);
    qualified_facts.push(...qualification.facts);
  }
  qualified_facts.sort((left, right) => left.id.localeCompare(right.id));

  if (
    !document_extractions.length ||
    document_extractions.every((item) =>
      ['failed', 'source_unavailable', 'corrupt_source'].includes(item.status),
    )
  ) {
    return { status: 'preparation_failed', reason: 'extraction_failed', ...common };
  }

  const reconciliation = reconcileQualifiedFactsForWholeIntake({
    facts: qualified_facts,
    source_acquisitions,
  });
  const proposals = buildProductionSemanticProposals({
    facts: qualified_facts,
    source_acquisitions,
    reconciliation,
  });
  const bridge = buildProductionProductCandidate({
    intake: request.intake,
    captures,
    source_acquisitions,
    facts: qualified_facts,
    reconciliation,
    proposals,
  });
  const review_package = buildProductionReviewPackage({
    intake: request.intake,
    reconciliation,
    bridge,
  });
  return { status: 'review_ready', ...common, reconciliation, proposals, bridge, review_package };
};
