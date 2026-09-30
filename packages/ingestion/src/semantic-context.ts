import {
  artifactDigest,
  type QualifiedFactArtifact,
  type SourceAcquisitionArtifact,
} from './production-contracts.js';
import reviewedContexts from '../../../data/ingestion/reviewed-semantic-contexts.json' with { type: 'json' };

export interface ReviewedSemanticContext {
  readonly role: 'battery';
  readonly region: 'battery_specs' | 'battery_charge' | 'body_dimensions';
  readonly vocabulary_version: string;
  readonly vocabulary_digest: string;
}

// This reviewed binding describes a source shape, not a manufacturer branch in
// semantic code. Its digest pins the profile that established exact-model table
// scope. A changed profile or table shape needs a separately reviewed binding.
const reviewedBindings = reviewedContexts.bindings;

const tablePath = (fact: QualifiedFactArtifact): string | undefined => {
  const paths = fact.evidence
    ?.filter((item) => item.role === 'label' || item.role === 'value')
    .map((item) =>
      item.locator?.kind === 'html'
        ? item.locator.path?.match(/^(.*\/table\[\d+\])\//)?.[1]
        : undefined,
    );
  return paths?.length === 2 && paths[0] && paths[0] === paths[1] ? paths[0] : undefined;
};

/** Missing or competing context fails closed. The role is never inferred from
 * manufacturer name, URL, a single word, or a caller-supplied product category.
 */
export const reviewedSemanticContext = (
  fact: QualifiedFactArtifact,
  allFacts: readonly QualifiedFactArtifact[],
  acquisitions: readonly SourceAcquisitionArtifact[],
): ReviewedSemanticContext | undefined => {
  const binding = fact.metadata.applicability;
  if (
    binding.kind !== 'exact_mpn_or_sku' ||
    !binding.value ||
    fact.qualification_state !== 'structurally_supported'
  )
    return undefined;
  const acquisition = acquisitions.find(
    (item) => artifactDigest(item) === fact.source_acquisition?.digest,
  );
  if (!acquisition || acquisition.seed_capture.digest !== fact.source_capture.digest)
    return undefined;
  const profile = acquisition.profile_binding;
  const matches = reviewedBindings.filter(
    (item) =>
      item.profile_id === profile?.profile_id && item.profile_digest === profile?.profile_digest,
  );
  if (matches.length !== 1) return undefined;
  const reviewed = matches[0];
  const path = tablePath(fact);
  if (!path) return undefined;
  const regions = reviewed.regions.filter((region) => path.endsWith(`/table[${region.ordinal}]`));
  if (regions.length !== 1) return undefined;
  const region = regions[0];
  const peers = allFacts.filter(
    (item) =>
      item.source_capture.digest === fact.source_capture.digest &&
      item.metadata.applicability.kind === binding.kind &&
      item.metadata.applicability.value === binding.value &&
      tablePath(item) === path,
  );
  const labels = peers.map((item) => item.metadata.source_label);
  if (!region.labels.every((label) => labels.filter((item) => item === label).length === 1))
    return undefined;
  return {
    role: reviewed.role as ReviewedSemanticContext['role'],
    region: region.region as ReviewedSemanticContext['region'],
    vocabulary_version: reviewed.version,
    vocabulary_digest: artifactDigest(reviewed),
  };
};
