import { extractDocumentAsync } from './document-extraction.js';
import { validateCaptureUri } from './http-capture.js';
import {
  manufacturerAcquisitionProfileDigest,
  resolveManufacturerAcquisitionProfile,
} from './manufacturer-acquisition.js';
import {
  artifactDigest,
  artifactReference,
  deterministicSerialize,
  validateProductionArtifactSchema,
  type ArtifactReference,
  type DocumentSourceLocation,
  type ProductIntake,
  type SourceAcquisitionProfileBinding,
  type SourceCaptureArtifact,
} from './production-contracts.js';
import { captureSourceForProduction } from './source-capture.js';
import type { SourceAcquisitionRequest } from './source-acquisition.js';

/** A human source-identity decision, separate from product fact approval and domain policy. */
export interface SourceResolutionArtifact {
  readonly schema_version: '1.0';
  readonly artifact_kind: 'source_resolution';
  readonly id: string;
  readonly intake: ArtifactReference<'product_intake'>;
  readonly manufacturer: string;
  readonly product_model: string;
  readonly manufacturer_part_number?: string;
  readonly attempt_id: string;
  readonly candidate_uri: string;
  readonly normalized_uri: string;
  readonly final_uri?: string;
  readonly discovery_method: 'operator_supplied_url';
  readonly capture: ArtifactReference<'source_capture'>;
  readonly captured_at: string;
  readonly domain_evidence: {
    readonly state:
      | 'profile_supported'
      | 'no_reviewed_profile'
      | 'outside_reviewed_domains'
      | 'final_domain_unobserved';
    readonly profile_binding?: SourceAcquisitionProfileBinding;
    readonly publisher?: string;
  };
  readonly title?: string;
  readonly observations: readonly {
    readonly kind: 'heading' | 'exact_manufacturer' | 'exact_model' | 'exact_mpn';
    readonly value: string;
    readonly locator: DocumentSourceLocation;
  }[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
  readonly disposition: 'pending' | 'accepted' | 'rejected';
  readonly review?: { readonly reviewed_at: string; readonly method: 'local_operator' };
}

const hostAllowed = (uri: string, exact: readonly string[], subdomains: readonly string[]) => {
  const host = new URL(uri).hostname.toLowerCase().replace(/\.$/, '');
  return (
    exact.some((value) => host === value.toLowerCase().replace(/\.$/, '')) ||
    subdomains.some((value) => {
      const root = value.toLowerCase().replace(/^\./, '').replace(/\.$/, '');
      return host === root || host.endsWith(`.${root}`);
    })
  );
};

/** Exact, case-sensitive token occurrence; no fuzzy or prefix identity inference. */
const containsExact = (text: string, value: string): boolean => {
  let start = text.indexOf(value);
  while (start !== -1) {
    const before = text[start - 1];
    const after = text[start + value.length];
    if ((!before || !/[\p{L}\p{N}_-]/u.test(before)) && (!after || !/[\p{L}\p{N}_-]/u.test(after)))
      return true;
    start = text.indexOf(value, start + 1);
  }
  return false;
};

export const captureSourceResolutionCandidate = async (
  request: SourceAcquisitionRequest,
  candidateUri: string,
  attemptId: string,
): Promise<{
  readonly resolution: SourceResolutionArtifact;
  readonly capture: SourceCaptureArtifact;
}> => {
  if (request.intake.official_product_uri)
    throw new Error('Source resolution is only available for URL-less intake.');
  const parsed = validateCaptureUri(candidateUri);
  if (!(parsed instanceof URL))
    throw new Error(
      `Invalid source resolution candidate: ${parsed.issues.map((item) => item.message).join('; ')}`,
    );
  parsed.hash = '';
  const normalized = parsed.toString();
  const selected =
    request.profile ??
    (() => {
      const result = resolveManufacturerAcquisitionProfile(request.profiles ?? [], request.intake);
      return result.status === 'resolved' ? result.profile : undefined;
    })();
  const profile =
    selected?.profile_status === 'reviewed' &&
    selected.manufacturer.trim().toLowerCase() === request.intake.manufacturer.trim().toLowerCase()
      ? selected
      : undefined;
  const captured = await captureSourceForProduction(
    request.adapter,
    {
      capture_id: `${attemptId}.capture`,
      uri: normalized,
      retention_status: request.policy?.retention_status ?? 'not_retained',
      source_provenance: { acquisition_stage: 'source_resolution' },
    },
    { snapshot_store: request.policy?.snapshot_store, now: request.policy?.now },
  );
  const finalUri = captured.artifact.final_uri;
  const requestedSupported =
    profile && hostAllowed(normalized, profile.official_domains, profile.approved_subdomains ?? []);
  const supported =
    profile &&
    hostAllowed(normalized, profile.official_domains, profile.approved_subdomains ?? []) &&
    finalUri &&
    hostAllowed(finalUri, profile.official_domains, profile.approved_subdomains ?? []);
  const document =
    captured.source && captured.disposition === 'authoritative'
      ? await extractDocumentAsync(captured.source)
      : undefined;
  const observations: SourceResolutionArtifact['observations'][number][] = [];
  const seen = new Set<string>();
  const append = (observation: SourceResolutionArtifact['observations'][number]) => {
    const key = deterministicSerialize(observation);
    if (observations.length < 30 && !seen.has(key)) {
      seen.add(key);
      observations.push(observation);
    }
  };
  const locatorOf = (
    block: NonNullable<typeof document>['blocks'][number],
  ): DocumentSourceLocation =>
    block.source_location ?? { kind: 'generic', fragment: block.locator.fragment };
  // Scan in identity priority, preserving document order within each kind.
  // Headings never consume capacity reserved for available exact observations.
  for (const [kind, value] of [
    ['exact_mpn', request.intake.manufacturer_part_number],
    ['exact_model', request.intake.product_model],
    ['exact_manufacturer', request.intake.manufacturer],
  ] as const) {
    if (!value) continue;
    for (const block of document?.blocks ?? []) {
      if (observations.length === 30) break;
      if (containsExact(block.text, value)) append({ kind, value, locator: locatorOf(block) });
    }
  }
  for (const block of document?.blocks ?? []) {
    if (observations.length === 30) break;
    if (block.kind === 'heading' && block.text.length <= 500)
      append({ kind: 'heading', value: block.text, locator: locatorOf(block) });
  }
  const resolution: SourceResolutionArtifact = {
    schema_version: '1.0',
    artifact_kind: 'source_resolution',
    id: attemptId,
    attempt_id: attemptId,
    intake: artifactReference(
      'product_intake',
      request.intake,
      request.intake.id,
      request.intake.schema_version,
    ),
    manufacturer: request.intake.manufacturer,
    product_model: request.intake.product_model,
    ...(request.intake.manufacturer_part_number
      ? { manufacturer_part_number: request.intake.manufacturer_part_number }
      : {}),
    candidate_uri: candidateUri,
    normalized_uri: normalized,
    ...(finalUri ? { final_uri: finalUri } : {}),
    discovery_method: 'operator_supplied_url',
    capture: artifactReference(
      'source_capture',
      captured.artifact,
      captured.artifact.id,
      captured.artifact.schema_version,
    ),
    captured_at: captured.artifact.retrieved_at,
    domain_evidence: {
      state: profile
        ? !requestedSupported || (finalUri && !supported)
          ? 'outside_reviewed_domains'
          : finalUri
            ? 'profile_supported'
            : 'final_domain_unobserved'
        : 'no_reviewed_profile',
      ...(profile
        ? {
            profile_binding: {
              profile_id: profile.id,
              profile_schema_version: profile.schema_version,
              profile_digest: manufacturerAcquisitionProfileDigest(profile),
            },
          }
        : {}),
      ...(supported && profile ? { publisher: profile.publisher } : {}),
    },
    ...(document?.title ? { title: document.title.slice(0, 500) } : {}),
    observations,
    diagnostics: [...captured.reasons, ...(document?.diagnostics ?? [])]
      .slice(0, 30)
      .map(({ code, message }) => ({ code, message: message.slice(0, 500) })),
    disposition: 'pending',
  };
  return { resolution, capture: captured.artifact };
};

export const assertAcceptedSourceResolution = (
  intake: ProductIntake,
  resolution: SourceResolutionArtifact,
): void => {
  if (
    validateProductionArtifactSchema(resolution).length ||
    intake.official_product_uri ||
    resolution.disposition !== 'accepted' ||
    !resolution.review ||
    resolution.intake.digest !== artifactDigest(intake) ||
    resolution.manufacturer !== intake.manufacturer ||
    resolution.product_model !== intake.product_model ||
    resolution.manufacturer_part_number !== intake.manufacturer_part_number ||
    !resolution.final_uri ||
    !(validateCaptureUri(resolution.final_uri) instanceof URL)
  )
    throw new Error(
      'Accepted source resolution is missing, invalid, or bound to a different intake.',
    );
};
