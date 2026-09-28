import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import {
  artifactDigest,
  artifactReference,
  PRODUCTION_SCHEMA_VERSION,
  type CaptureDisposition,
  type CaptureReasonCode,
  type ProductIntake,
  type SourceAcquisitionArtifact,
  type SourceAcquisitionCandidate,
  type SourceAcquisitionStatus,
  type SourceCandidateCaptureOutcome,
  type SourceDiscoveryMethod,
  type SourceDiscoveryProvenance,
  type SourceOfficiality,
  type SourceRole,
} from './production-contracts.js';
import {
  manufacturerAcquisitionProfileDigest,
  resolveManufacturerAcquisitionProfile,
  resolveManufacturerAcquisitionStrategy,
  type ManufacturerAcquisitionProfile,
  type ManufacturerAcquisitionStrategy,
} from './manufacturer-acquisition.js';
import { validateCaptureUri } from './http-capture.js';
import {
  assertAcceptedSourceResolution,
  type SourceResolutionArtifact,
} from './source-resolution.js';
import type { CapturedSource, SourceCaptureAdapter } from './capture-types.js';
import {
  captureSourceForProduction,
  type ExpectedContentAssertion,
  type ProductionSourceCaptureResult,
  type SnapshotStore,
} from './source-capture.js';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export interface SourceAcquisitionPolicy {
  readonly max_discovered_candidates?: number;
  readonly max_captured_candidates?: number;
  readonly max_recursion_depth?: number;
  readonly retention_status?: 'retained' | 'not_retained' | 'not_permitted' | 'unknown';
  readonly snapshot_store?: SnapshotStore;
  readonly now?: () => string;
  readonly expected_content?: readonly ExpectedContentAssertion[];
}

export interface SourceAcquisitionRequest {
  readonly intake: ProductIntake;
  readonly source_resolution?: SourceResolutionArtifact;
  readonly adapter: SourceCaptureAdapter;
  readonly profiles?: readonly ManufacturerAcquisitionProfile[];
  readonly profile?: ManufacturerAcquisitionProfile;
  readonly policy?: SourceAcquisitionPolicy;
  readonly expected_content?: readonly ExpectedContentAssertion[];
}

export interface SourceAcquisitionCandidateResult {
  readonly candidate: SourceAcquisitionCandidate;
  readonly capture?: ProductionSourceCaptureResult;
}

export interface SourceAcquisitionResult {
  readonly status: SourceAcquisitionStatus;
  readonly artifact?: SourceAcquisitionArtifact;
  readonly seed_capture: ProductionSourceCaptureResult;
  readonly candidates: readonly SourceAcquisitionCandidateResult[];
  readonly issues: readonly string[];
}

interface DiscoveredLink {
  readonly raw_uri: string;
  readonly normalized_uri: string;
  readonly method: SourceDiscoveryMethod;
  readonly locator?: string;
  readonly source_label?: string;
  readonly role_hints?: readonly { readonly pattern: string; readonly role: SourceRole }[];
  readonly profile_id?: string;
  readonly profile_rule_id?: string;
  readonly manual_document_context?: boolean;
}

interface DomainPolicy {
  readonly official_domains: readonly string[];
  readonly approved_subdomains: readonly string[];
  readonly document_domains: readonly string[];
  readonly document_subdomains: readonly string[];
  readonly seed_host: string;
}

const DEFAULT_MAX_DISCOVERED = 50;
const DEFAULT_MAX_CAPTURED = 20;
const DEFAULT_MAX_DEPTH = 0;
// Retain the first eight sorted occurrences per resource per immediate parent.
// Depth one expands at most discoveredLimit parents, so retained provenance and
// pending work remain bounded without changing the durable candidate contract.
const MAX_OCCURRENCES_PER_RESOURCE_PER_PARENT = 8;
const TECHNICAL_TERMS =
  /datasheet|data[-_\s]?sheet|manual|install|technical|spec(?:ification)?|dimension|drawing|support|help|certificate|firmware|compatib|product/i;
const DOCUMENT_CONTEXT_TERMS =
  /datasheet|data[-_\s]?sheet|manual|install|technical|spec(?:ification)?|dimension|drawing|certificate|firmware|compatib/i;
const DOCUMENT_FORMAT_LABEL = /^(?:html5?|pdf)$/i;
const NON_DOCUMENT_EXTENSIONS = /\.(?:css|js|json|ico|gif|jpe?g|png|webp|svg|woff2?|zip)$/i;
const METHOD_ORDER: readonly SourceDiscoveryMethod[] = [
  'seed_page_anchor',
  'html_link_element',
  'structured_application_state',
  'profile_rule',
  'maintainer_hint',
];

const attr = (element: Element, name: string): string | undefined =>
  element.attrs.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;

const textOf = (node: ChildNode): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(textOf).join('') : '';

const walk = (node: ParentNode, visit: (element: Element) => void): void => {
  for (const child of node.childNodes) {
    if (!('tagName' in child)) continue;
    visit(child);
    walk(child, visit);
  }
};

const manualDocumentContextFor = (anchor: Element): string => {
  let parent = anchor.parentNode;
  while (parent && 'tagName' in parent) {
    if (parent.tagName === 'li') {
      const itemText = textOf(parent).replace(textOf(anchor), '');
      const list = parent.parentNode;
      if (list && 'tagName' in list && (list.tagName === 'ul' || list.tagName === 'ol')) {
        const container = list.parentNode;
        if (container && 'childNodes' in container) {
          const siblings = container.childNodes;
          const listIndex = siblings.indexOf(list);
          const preceding = siblings
            .slice(0, listIndex)
            .reverse()
            .find((node) => 'tagName' in node);
          if (preceding && 'tagName' in preceding && /^h[1-6]$/.test(preceding.tagName)) {
            return `${itemText} ${textOf(preceding)}`;
          }
        }
      }
      return itemText;
    }
    parent = parent.parentNode;
  }
  return '';
};

const normalizeUri = (raw: string, parent?: string): string | undefined => {
  try {
    const value = new URL(raw, parent);
    if (value.protocol !== 'http:' && value.protocol !== 'https:') return undefined;
    value.hash = '';
    if (
      (value.protocol === 'https:' && value.port === '443') ||
      (value.protocol === 'http:' && value.port === '80')
    ) {
      value.port = '';
    }
    return value.toString();
  } catch {
    return undefined;
  }
};

const hostname = (uri: string): string | undefined => {
  try {
    return new URL(uri).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return undefined;
  }
};

const hostAllowed = (
  value: string,
  exact: readonly string[],
  subdomains: readonly string[],
): boolean => {
  const normalized = value.toLowerCase().replace(/\.$/, '');
  return (
    exact.some((host) => normalized === host.toLowerCase().replace(/\.$/, '')) ||
    subdomains.some((host) => {
      const root = host.toLowerCase().replace(/^\./, '').replace(/\.$/, '');
      return normalized === root || normalized.endsWith(`.${root}`);
    })
  );
};

const profilePolicy = (
  intake: ProductIntake,
  profile?: ManufacturerAcquisitionProfile,
  resolvedSeed?: string,
): DomainPolicy => {
  const seedHost =
    (resolvedSeed
      ? hostname(resolvedSeed)
      : intake.official_product_uri
        ? hostname(intake.official_product_uri)
        : undefined) ?? '';
  return {
    official_domains: profile?.official_domains ?? [seedHost],
    approved_subdomains: profile?.approved_subdomains ?? [],
    document_domains: profile?.allowed_document_domains ?? [],
    document_subdomains: profile?.allowed_document_subdomains ?? [],
    seed_host: seedHost,
  };
};

const seedOfficial = (uri: string, policy: DomainPolicy): boolean => {
  const host = hostname(uri);
  return (
    host !== undefined && hostAllowed(host, policy.official_domains, policy.approved_subdomains)
  );
};

const candidateOfficiality = (uri: string, policy: DomainPolicy): SourceOfficiality => {
  const host = hostname(uri);
  if (!host) return 'unresolved';
  if (hostAllowed(host, policy.official_domains, policy.approved_subdomains)) return 'official';
  if (hostAllowed(host, policy.document_domains, policy.document_subdomains)) return 'official';
  if (!policy.document_domains.length && host === policy.seed_host) return 'official';
  return 'blocked';
};

const roleFromText = (
  uri: string,
  label: string,
  mediaType?: string,
): { role: SourceRole; evidence: string[] } => {
  const value = `${label} ${uri}`.toLowerCase();
  const evidence: string[] = [];
  if (/\binstallation(?:[-_\s]?manual)?\b|\binstall(?:ation)?[-_\s]?guide\b/.test(value)) {
    evidence.push('installation wording');
    return { role: 'installation_manual', evidence };
  }
  if (/\btechnical[-_\s]?manual\b/.test(value)) {
    evidence.push('technical manual wording');
    return { role: 'technical_manual', evidence };
  }
  if (/\bdatasheet\b|\bdata[-_\s]?sheet\b/.test(value)) {
    evidence.push('datasheet wording');
    return { role: 'datasheet', evidence };
  }
  if (/\bspec(?:ification)?(?:[-_\s]?sheet)?\b/.test(value)) {
    evidence.push('specification wording');
    return { role: 'specification_sheet', evidence };
  }
  if (/\bdimensional?[-_\s]?drawing\b|\bdimension(?:s)?\b/.test(value)) {
    evidence.push('dimensional drawing wording');
    return { role: 'dimensional_drawing', evidence };
  }
  if (/\btechnical[-_\s]?drawing\b/.test(value) || /\bdrawing\b/.test(value)) {
    evidence.push('drawing wording');
    return { role: 'technical_drawing', evidence };
  }
  if (/\bmanual\b|\buser[-_\s]?guide\b|\bguide\b/.test(value)) {
    evidence.push('manual wording');
    return { role: 'manual', evidence };
  }
  if (/\bsupport\b|\bhelp\b|\bfaq\b/.test(value) && !/\.(?:pdf)\b/.test(value)) {
    evidence.push('support wording');
    return { role: 'support_article', evidence };
  }
  if (/\bcertificate\b|\bcertification\b/.test(value)) {
    evidence.push('certificate wording');
    return { role: 'certificate', evidence };
  }
  if (/\bfirmware\b|\bhardware[-_\s]?compatib/.test(value)) {
    evidence.push('firmware or compatibility wording');
    return { role: 'firmware_document', evidence };
  }
  if (mediaType?.includes('html') && /\bproduct\b/.test(value)) {
    evidence.push('product-page wording');
    return { role: 'product_page', evidence };
  }
  return { role: 'unknown', evidence };
};

const classifyRole = (
  link: DiscoveredLink,
  strategy?: ManufacturerAcquisitionStrategy,
): { role: SourceRole; evidence: string[] } => {
  const hints = [
    ...(link.role_hints ?? []),
    ...(strategy?.document_link_discovery.role_hints ?? []),
  ];
  for (const hint of hints.sort((left, right) => left.pattern.localeCompare(right.pattern))) {
    try {
      if (new RegExp(hint.pattern, 'i').test(`${link.source_label ?? ''} ${link.normalized_uri}`)) {
        return { role: hint.role, evidence: [`profile rule: ${hint.pattern}`] };
      }
    } catch {
      // Invalid proposed hints are never executed; reviewed profiles are schema validated.
    }
  }
  return roleFromText(link.normalized_uri, link.source_label ?? '');
};

const roleHintFor = (strategy?: ManufacturerAcquisitionStrategy) =>
  strategy?.document_link_discovery.role_hints;

const profileExpectedContent = (
  strategy?: ManufacturerAcquisitionStrategy,
): readonly ExpectedContentAssertion[] =>
  (strategy?.document_link_discovery.expected_content ?? []) as readonly ExpectedContentAssertion[];

const isTechnicalCandidate = (
  rawUri: string,
  label: string,
  strategy?: ManufacturerAcquisitionStrategy,
  structuralContext = '',
): boolean => {
  if (NON_DOCUMENT_EXTENSIONS.test(rawUri)) return false;
  if (strategy) return true;
  return (
    TECHNICAL_TERMS.test(`${rawUri} ${label}`) ||
    (DOCUMENT_FORMAT_LABEL.test(label) &&
      TECHNICAL_TERMS.test(structuralContext) &&
      DOCUMENT_CONTEXT_TERMS.test(structuralContext))
  );
};

const collectStructuredLinks = (
  value: unknown,
  parentPath: string,
  output: DiscoveredLink[],
  parentUri: string,
  profile: ManufacturerAcquisitionProfile,
  strategy: ManufacturerAcquisitionStrategy,
): void => {
  if (typeof value === 'string') {
    const normalized = /^(?:https?:\/\/|\/|\.\/|\.\.\/)/i.test(value)
      ? normalizeUri(value, parentUri)
      : undefined;
    if (normalized && (TECHNICAL_TERMS.test(parentPath) || TECHNICAL_TERMS.test(value))) {
      output.push({
        raw_uri: value,
        normalized_uri: normalized,
        method: 'structured_application_state',
        locator: parentPath,
        profile_id: profile.id,
        profile_rule_id: strategy.id,
        role_hints: roleHintFor(strategy),
      });
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      collectStructuredLinks(
        child,
        `${parentPath}[${index}]`,
        output,
        parentUri,
        profile,
        strategy,
      ),
    );
    return;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) =>
    collectStructuredLinks(child, `${parentPath}.${key}`, output, parentUri, profile, strategy),
  );
};

const discoverLinks = (
  captured: CapturedSource,
  intake: ProductIntake,
  profile: ManufacturerAcquisitionProfile | undefined,
  strategy: ManufacturerAcquisitionStrategy | undefined,
  includeSeedLinks = true,
): readonly DiscoveredLink[] => {
  const output: DiscoveredLink[] = [];
  const base = captured.final_uri;
  for (const raw of (includeSeedLinks ? strategy?.document_link_discovery.document_urls : []) ??
    []) {
    const normalized = normalizeUri(raw, base);
    if (!normalized) continue;
    output.push({
      raw_uri: raw,
      normalized_uri: normalized,
      method: 'profile_rule',
      locator: 'strategies[].document_urls',
      profile_id: profile?.id,
      profile_rule_id: strategy?.id,
      role_hints: roleHintFor(strategy),
    });
  }
  if (captured.body.text) {
    const document = parse(captured.body.text) as Document;
    let linkIndex = 0;
    walk(document, (element) => {
      if (element.tagName !== 'a' && element.tagName !== 'link') return;
      const raw = attr(element, 'href');
      if (!raw) return;
      const label =
        textOf(element).replace(/\s+/g, ' ').trim() ||
        attr(element, 'aria-label') ||
        attr(element, 'title');
      const structuralContext = element.tagName === 'a' ? manualDocumentContextFor(element) : '';
      const manualDocumentContext =
        TECHNICAL_TERMS.test(structuralContext) && DOCUMENT_CONTEXT_TERMS.test(structuralContext);
      if (!isTechnicalCandidate(raw, label ?? '', strategy, structuralContext)) return;
      const normalized = normalizeUri(raw, base);
      if (!normalized) return;
      output.push({
        raw_uri: raw,
        normalized_uri: normalized,
        method: element.tagName === 'a' ? 'seed_page_anchor' : 'html_link_element',
        locator: `href[${linkIndex}]`,
        source_label: label,
        profile_id: profile?.id,
        profile_rule_id: strategy?.id,
        role_hints: roleHintFor(strategy),
        ...(manualDocumentContext ? { manual_document_context: true } : {}),
      });
      linkIndex += 1;
    });
    if (profile && strategy) {
      let rawJson: string | undefined;
      walk(document, (element) => {
        if (
          element.tagName === 'script' &&
          attr(element, 'id') === strategy.embedded_json.script.id
        ) {
          rawJson = textOf(element);
        }
      });
      if (rawJson) {
        try {
          collectStructuredLinks(
            JSON.parse(rawJson) as unknown,
            '$',
            output,
            base,
            profile,
            strategy,
          );
        } catch {
          // Discovery remains conservative when a reviewed state payload is malformed.
        }
      }
    }
  }
  (includeSeedLinks ? (intake.additional_official_source_uris ?? []) : []).forEach((raw) => {
    const normalized = normalizeUri(raw, base);
    if (!normalized) return;
    output.push({
      raw_uri: raw,
      normalized_uri: normalized,
      method: 'maintainer_hint',
      locator: 'ProductIntake.additional_official_source_uris',
    });
  });
  return output;
};

const compareLinks = (left: DiscoveredLink, right: DiscoveredLink): number => {
  const normalized = left.normalized_uri.localeCompare(right.normalized_uri);
  if (normalized) return normalized;
  const method = METHOD_ORDER.indexOf(left.method) - METHOD_ORDER.indexOf(right.method);
  if (method) return method;
  return (
    left.raw_uri.localeCompare(right.raw_uri) ||
    (left.source_label ?? '').localeCompare(right.source_label ?? '') ||
    (left.locator ?? '').localeCompare(right.locator ?? '')
  );
};

const captureReasonCodes = (result: ProductionSourceCaptureResult): readonly CaptureReasonCode[] =>
  result.reasons.map((reason) => reason.code as CaptureReasonCode);

const captureOutcomeFor = (disposition: CaptureDisposition): SourceCandidateCaptureOutcome =>
  disposition === 'authoritative'
    ? 'authoritative'
    : disposition === 'non_authoritative'
      ? 'non_authoritative'
      : 'failed';

const makeCandidateId = (intakeId: string, index: number): string =>
  `${intakeId}.source.${index + 1}`;

const emptySeedResult = (
  intake: ProductIntake,
  message: string,
  reasonCode: CaptureReasonCode = 'invalid_uri',
  resolvedSeed?: string,
): ProductionSourceCaptureResult => ({
  disposition: 'failed',
  artifact: {
    schema_version: PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'source_capture',
    id: `${intake.id}.seed`,
    requested_uri: resolvedSeed ?? intake.official_product_uri!,
    retrieved_at: '1970-01-01T00:00:00.000Z',
    disposition: 'failed',
    reason_codes: [reasonCode],
    retention_status: 'unknown',
    source_provenance: { validation_error: message },
  },
  reasons: [{ code: reasonCode, message }],
});

const statusFor = (
  seed: ProductionSourceCaptureResult,
  candidates: readonly SourceAcquisitionCandidateResult[],
  seedOfficiality: SourceOfficiality,
): SourceAcquisitionStatus => {
  if (seedOfficiality !== 'official') return 'unresolved_officiality';
  if (seed.disposition !== 'authoritative') return 'seed_failed';
  const selected = candidates.filter(({ candidate }) => candidate.selection_status === 'selected');
  const authoritative = selected.filter(
    ({ candidate }) => candidate.capture_outcome === 'authoritative',
  );
  const attempted = selected.filter(
    ({ candidate }) => candidate.capture_outcome !== 'not_attempted',
  );
  const unattempted = selected.some(
    ({ candidate }) => candidate.capture_outcome === 'not_attempted',
  );
  const unresolved = candidates.some(({ candidate }) => candidate.officiality === 'unresolved');
  const blocked = candidates.some(({ candidate }) => candidate.officiality === 'blocked');
  if (!selected.length && unresolved) return 'unresolved_officiality';
  if (!selected.length && blocked) return 'blocked';
  if (!selected.length) return 'insufficient_sources';
  if (unresolved && !authoritative.length) return 'unresolved_officiality';
  if (!authoritative.length) {
    if (!attempted.length) return 'insufficient_sources';
    return attempted.every(({ candidate }) => candidate.capture_outcome === 'failed')
      ? 'failed'
      : 'partially_acquired';
  }
  return candidates.some(
    ({ candidate }) =>
      candidate.capture_outcome === 'failed' ||
      candidate.capture_outcome === 'non_authoritative' ||
      unattempted,
  )
    ? 'partially_acquired'
    : 'acquired';
};

const createAcquisitionArtifact = (
  intake: ProductIntake,
  seed: ProductionSourceCaptureResult,
  profile: ManufacturerAcquisitionProfile | undefined,
  status: SourceAcquisitionStatus,
  officiality: SourceOfficiality,
  candidates: readonly SourceAcquisitionCandidate[],
  resolution?: SourceResolutionArtifact,
): SourceAcquisitionArtifact => {
  const seedReference = artifactReference(
    'source_capture',
    seed.artifact,
    seed.artifact.id,
    seed.artifact.schema_version,
  );
  const candidateIds = (officiality: SourceOfficiality) =>
    candidates
      .filter((candidate) => candidate.officiality === officiality)
      .map((candidate) => candidate.id);
  const baseArtifact = {
    schema_version: PRODUCTION_SCHEMA_VERSION as typeof PRODUCTION_SCHEMA_VERSION,
    artifact_kind: 'source_acquisition' as const,
    id: `${intake.id}.source-acquisition`,
    intake: artifactReference('product_intake', intake),
    ...(resolution
      ? {
          source_resolution: artifactReference(
            'source_resolution',
            resolution,
            resolution.id,
            resolution.schema_version,
          ),
        }
      : {}),
    seed_capture: seedReference,
    ...(profile
      ? {
          profile_binding: {
            profile_id: profile.id,
            profile_schema_version: profile.schema_version,
            profile_digest: manufacturerAcquisitionProfileDigest(profile),
          },
        }
      : {}),
    officiality,
    status,
    candidates,
    ...(candidateIds('unresolved').length
      ? { unresolved_candidate_ids: candidateIds('unresolved') }
      : {}),
    ...(candidateIds('blocked').length ? { blocked_candidate_ids: candidateIds('blocked') } : {}),
  };
  return { ...baseArtifact, deterministic_snapshot: artifactDigest(baseArtifact) };
};

export const acquireOfficialSources = async (
  request: SourceAcquisitionRequest,
): Promise<SourceAcquisitionResult> => {
  const policy = request.policy ?? {};
  const buildAcquisitionArtifact = (
    ...args: [
      ProductIntake,
      ProductionSourceCaptureResult,
      ManufacturerAcquisitionProfile | undefined,
      SourceAcquisitionStatus,
      SourceOfficiality,
      readonly SourceAcquisitionCandidate[],
    ]
  ) => createAcquisitionArtifact(...args, request.source_resolution);
  if (request.source_resolution)
    assertAcceptedSourceResolution(request.intake, request.source_resolution);
  const effectiveSeed = request.source_resolution?.final_uri ?? request.intake.official_product_uri;
  if (!effectiveSeed)
    throw new Error('Official source resolution required before source acquisition.');
  const maxDiscovered = policy.max_discovered_candidates ?? DEFAULT_MAX_DISCOVERED;
  const maxCaptured = policy.max_captured_candidates ?? DEFAULT_MAX_CAPTURED;
  const maxDepth = policy.max_recursion_depth ?? DEFAULT_MAX_DEPTH;
  const selectedProfile =
    request.profile ??
    (request.profiles
      ? (() => {
          const resolved = resolveManufacturerAcquisitionProfile(
            request.profiles ?? [],
            request.intake,
          );
          return resolved.status === 'resolved' ? resolved.profile : undefined;
        })()
      : undefined);
  const reviewedProfile =
    selectedProfile?.profile_status === 'reviewed' ? selectedProfile : undefined;
  const profile = reviewedProfile;
  const domain = profilePolicy(request.intake, profile, effectiveSeed);
  const seedUri = validateCaptureUri(effectiveSeed);
  if (!(seedUri instanceof URL)) {
    const seed = emptySeedResult(
      request.intake,
      seedUri.issues.map((item) => item.message).join('; '),
      (seedUri.issues[0]?.code as CaptureReasonCode | undefined) ?? 'invalid_uri',
      effectiveSeed,
    );
    const status = 'seed_failed' as const;
    return {
      status,
      artifact: buildAcquisitionArtifact(request.intake, seed, profile, status, 'unresolved', []),
      seed_capture: seed,
      candidates: [],
      issues: seed.reasons.map((item) => item.message),
    };
  }
  if (!seedOfficial(seedUri.toString(), domain)) {
    const seed = emptySeedResult(
      request.intake,
      'The seed URI is outside the reviewed official-domain policy.',
      'invalid_uri',
      effectiveSeed,
    );
    const status = 'unresolved_officiality' as const;
    return {
      status,
      artifact: buildAcquisitionArtifact(request.intake, seed, profile, status, 'unresolved', []),
      seed_capture: seed,
      candidates: [],
      issues: ['seed officiality unresolved'],
    };
  }
  const strategy = profile
    ? (() => {
        const resolved = resolveManufacturerAcquisitionStrategy(profile, seedUri.toString());
        return resolved.status === 'resolved' ? resolved.strategy : undefined;
      })()
    : undefined;
  const seed = await captureSourceForProduction(
    request.adapter,
    {
      capture_id: `${request.intake.id}.seed`,
      uri: seedUri.toString(),
      retention_status: policy.retention_status ?? 'not_retained',
      expected_content: [
        ...profileExpectedContent(strategy),
        ...(policy.expected_content ?? []),
        ...(request.expected_content ?? []),
      ],
      source_provenance: {
        acquisition_stage: 'source_acquisition',
        source_role: 'product_page',
        ...(profile ? { publisher: profile.publisher } : {}),
      },
    },
    { snapshot_store: policy.snapshot_store, now: policy.now },
  );
  const seedFinalOfficiality =
    seed.source && candidateOfficiality(seed.source.final_uri, domain) === 'official'
      ? 'official'
      : 'unresolved';
  if (seed.disposition !== 'authoritative' || seedFinalOfficiality !== 'official') {
    const status =
      seedFinalOfficiality === 'official'
        ? ('seed_failed' as const)
        : ('unresolved_officiality' as const);
    return {
      status,
      artifact: buildAcquisitionArtifact(
        request.intake,
        seed,
        profile,
        status,
        seedFinalOfficiality,
        [],
      ),
      seed_capture: seed,
      candidates: [],
      issues: seed.reasons.map((item) => item.message),
    };
  }
  const seedSource = seed.source;
  if (!seedSource) {
    const status = 'seed_failed' as const;
    return {
      status,
      artifact: buildAcquisitionArtifact(request.intake, seed, profile, status, 'unresolved', []),
      seed_capture: seed,
      candidates: [],
      issues: ['authoritative seed capture did not include source content'],
    };
  }
  if (maxDepth < 0 || maxDepth > 1 || !Number.isInteger(maxDepth)) {
    const status = 'blocked' as const;
    return {
      status,
      artifact: buildAcquisitionArtifact(request.intake, seed, profile, status, 'official', []),
      seed_capture: seed,
      candidates: [],
      issues: ['source discovery supports only depth 0 or 1'],
    };
  }
  const discoveredLimit =
    Number.isInteger(maxDiscovered) && maxDiscovered >= 0 ? maxDiscovered : DEFAULT_MAX_DISCOVERED;
  const discoveredResources = new Set<string>();
  const provenanceIssues: string[] = [];
  const boundedLinks = (links: readonly DiscoveredLink[]): DiscoveredLink[] => {
    const occurrences = new Map<string, number>();
    let newResources = 0;
    let truncated = false;
    const retained = [...links].sort(compareLinks).filter((link) => {
      if (
        link.normalized_uri === seedSource.final_uri ||
        link.normalized_uri === seedUri.toString()
      )
        return false;
      const count = occurrences.get(link.normalized_uri) ?? 0;
      if (!count && !discoveredResources.has(link.normalized_uri)) {
        if (newResources >= discoveredLimit) return false;
        newResources += 1;
      }
      occurrences.set(link.normalized_uri, count + 1);
      if (count >= MAX_OCCURRENCES_PER_RESOURCE_PER_PARENT) {
        truncated = true;
        return false;
      }
      return true;
    });
    if (truncated)
      provenanceIssues.push(
        'Discovery provenance limited to eight occurrences per resource per parent.',
      );
    return retained;
  };
  const links = boundedLinks(discoverLinks(seedSource, request.intake, profile, strategy));
  const byUri = new Map<string, string>();
  const candidateResults: SourceAcquisitionCandidateResult[] = [];
  const digestOwners = new Map<string, string>();
  const pending: {
    link: DiscoveredLink;
    parent: CapturedSource;
    parentCaptureId: string;
    depth: 0 | 1;
  }[] = links.map((link) => ({
    link,
    parent: seedSource,
    parentCaptureId: seed.artifact.id,
    depth: 0,
  }));
  let capturedCount = 0;
  for (let position = 0; position < pending.length; position += 1) {
    const { link, parent, parentCaptureId, depth } = pending[position];
    if (link.normalized_uri === seedSource.final_uri || link.normalized_uri === seedUri.toString())
      continue;
    if (!discoveredResources.has(link.normalized_uri)) {
      if (discoveredResources.size >= discoveredLimit) continue;
      discoveredResources.add(link.normalized_uri);
    }
    const id = makeCandidateId(request.intake.id, candidateResults.length);
    const officiality = candidateOfficiality(link.normalized_uri, domain);
    const duplicateOf = byUri.get(link.normalized_uri);
    const provenance: SourceDiscoveryProvenance = {
      parent_capture_id: parentCaptureId,
      parent_uri: parent.final_uri,
      raw_discovered_uri: link.raw_uri,
      normalized_uri: link.normalized_uri,
      method: link.method,
      ...(link.locator ? { locator: link.locator } : {}),
      ...(link.source_label ? { source_label: link.source_label } : {}),
      ...(link.profile_id ? { profile_id: link.profile_id } : {}),
      ...(link.profile_rule_id ? { profile_rule_id: link.profile_rule_id } : {}),
    };
    const classified = classifyRole(link, depth === 0 ? strategy : undefined);
    let candidate: SourceAcquisitionCandidate = {
      id,
      raw_discovered_uri: link.raw_uri,
      normalized_uri: link.normalized_uri,
      discovery: provenance,
      officiality,
      role: classified.role,
      ...(classified.evidence.length ? { role_evidence: classified.evidence } : {}),
      selection_status: duplicateOf
        ? 'duplicate_uri'
        : officiality === 'official'
          ? 'discovered'
          : 'excluded_by_policy',
      capture_outcome: 'not_attempted',
      content_equivalence: 'unknown',
      ...(duplicateOf ? { duplicate_of_candidate_id: duplicateOf } : {}),
    };
    if (!duplicateOf) byUri.set(link.normalized_uri, id);
    if (candidate.selection_status === 'discovered' && capturedCount < maxCaptured) {
      capturedCount += 1;
      candidate = { ...candidate, selection_status: 'selected' };
      const capture = await captureSourceForProduction(
        request.adapter,
        {
          capture_id: `${id}.capture`,
          uri: link.normalized_uri,
          retention_status: policy.retention_status ?? 'not_retained',
          expected_content: [
            ...(policy.expected_content ?? []),
            ...(request.expected_content ?? []),
          ],
          source_provenance: {
            acquisition_stage: 'source_acquisition',
            candidate_id: id,
            source_role: classified.role,
            ...(profile ? { publisher: profile.publisher } : {}),
          },
        },
        { snapshot_store: policy.snapshot_store, now: policy.now },
      );
      const finalOfficiality = capture.source
        ? candidateOfficiality(capture.source.final_uri, domain)
        : 'official';
      const observedRole =
        candidate.role === 'unknown' && capture.source
          ? roleFromText(link.normalized_uri, link.source_label ?? '', capture.source.media_type)
          : undefined;
      candidate = {
        ...candidate,
        ...(observedRole
          ? {
              role: observedRole.role,
              ...(observedRole.evidence.length ? { role_evidence: observedRole.evidence } : {}),
            }
          : {}),
        officiality: finalOfficiality,
        capture_outcome: captureOutcomeFor(capture.disposition),
        capture: artifactReference(
          'source_capture',
          capture.artifact,
          capture.artifact.id,
          capture.artifact.schema_version,
        ),
        capture_disposition: capture.disposition,
        ...(capture.reasons.length ? { capture_reason_codes: captureReasonCodes(capture) } : {}),
        ...(capture.artifact.content_digest
          ? {
              content_digest: capture.artifact.content_digest,
              content_equivalence: 'unique' as const,
            }
          : {}),
      };
      const digest = capture.artifact.content_digest;
      if (digest && digestOwners.has(digest)) {
        candidate = {
          ...candidate,
          content_equivalence: 'equivalent',
          equivalent_content_of_candidate_id: digestOwners.get(digest),
        };
      } else if (digest) {
        digestOwners.set(digest, id);
      }
      if (capture.source) {
        const finalUri = normalizeUri(capture.source.final_uri);
        if (finalUri && !byUri.has(finalUri)) byUri.set(finalUri, id);
      }
      candidateResults.push({ candidate, capture });
      if (
        depth === 0 &&
        maxDepth === 1 &&
        link.manual_document_context &&
        capture.disposition === 'authoritative' &&
        capture.source &&
        capture.source.media_type?.toLowerCase().includes('html') &&
        finalOfficiality === 'official'
      ) {
        const childParent = capture.source;
        const children = boundedLinks(
          discoverLinks(childParent, request.intake, profile, undefined, false),
        );
        pending.splice(
          position + 1,
          0,
          ...children.map((child) => ({
            link: child,
            parent: childParent,
            parentCaptureId: capture.artifact.id,
            depth: 1 as const,
          })),
        );
      }
      continue;
    }
    candidateResults.push({ candidate });
  }
  const status = statusFor(seed, candidateResults, seedFinalOfficiality);
  const artifact = buildAcquisitionArtifact(
    request.intake,
    seed,
    profile,
    status,
    seedFinalOfficiality,
    candidateResults.map(({ candidate }) => candidate),
  );
  return {
    status,
    artifact,
    seed_capture: seed,
    candidates: candidateResults,
    issues: [
      ...provenanceIssues,
      ...candidateResults.flatMap(
        ({ capture }) => capture?.reasons.map((reason) => reason.message) ?? [],
      ),
    ],
  };
};

export const acquireSourceAcquisition = acquireOfficialSources;
export const runSourceAcquisition = acquireOfficialSources;
