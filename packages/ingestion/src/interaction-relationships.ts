// Public facade for interaction-relationship contracts, validation,
// promotion, and persistence.
//
// The interaction-relationship implementation is split across bounded
// modules (types / validation / promotion / persistence); this file exists
// purely so existing callers can keep importing from
// './interaction-relationships.js' without needing to understand the
// internal decomposition. It intentionally re-exports only the symbols that
// were public before the module boundary refactor (Checkpoint G4) — it does
// not re-export module-internal helpers that other interaction-relationship
// modules use to compose behavior (e.g. the internal issue constructor or
// the concrete-identity-resolution predicate).

export type {
  CanonicalInteractionRelationshipCandidate,
  CanonicalInteractionRelationshipFilesystem,
  CanonicalInteractionRelationshipIssue,
  CanonicalInteractionRelationshipIssueCode,
  CanonicalInteractionRelationshipRequest,
  CanonicalInteractionRelationshipResult,
  CanonicalInteractionRelationshipReview,
  CanonicalInteractionRelationshipStatus,
  InteractionEvidenceApplicability,
  InteractionEvidenceScopeKind,
  InteractionEvidenceScope,
  InteractionEngineeringParticipantReference,
  InteractionApplicability,
  InteractionPrerequisite,
  InteractionInformationClaimV2,
  InteractionInformationDistribution,
  InteractionControlClaim,
  InteractionEvidenceApplicabilityScope,
  InteractionInformationClaim,
  InteractionParticipantReferenceResolver,
  InteractionRelationship,
  InteractionRelationshipCondition,
  InteractionRelationshipKind,
  InteractionRelationshipParticipant,
  InteractionRelationshipParticipantV2,
  InteractionRelationshipParticipantKind,
  InteractionRelationshipPromotionHistoryEntry,
  InteractionRelationshipScope,
  InteractionRelationshipValidation,
  InteractionRelationshipValidationIssue,
} from './interaction-relationship-types.js';

export type {
  InteractionInterpretationQuery,
  InteractionInterpretationReason,
  InteractionInterpretationResult,
  InteractionInterpretationStatus,
} from './interaction-relationship-interpretation.js';

export { validateInteractionRelationships } from './interaction-relationship-validation.js';

export {
  interpretInteractionRelationship,
  interpretInteractionRelationships,
} from './interaction-relationship-interpretation.js';

export {
  canonicalInteractionRelationshipProposal,
  canonicalInteractionRelationshipSnapshot,
  proposeCanonicalInteractionRelationship,
  validateCanonicalInteractionRelationship,
} from './interaction-relationship-promotion.js';

export {
  applyCanonicalInteractionRelationship,
  writeCanonicalInteractionRelationship,
} from './interaction-relationship-persistence.js';
