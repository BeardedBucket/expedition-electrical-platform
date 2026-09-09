import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import profileSchema from '../../../data/schemas/manufacturer-acquisition-profile.schema.json' with { type: 'json' };
import type { CapturedSource } from './capture-types.js';
import { createProductSource } from './capture-types.js';
import type { JsonObject, JsonValue, ProductIdentityClaim, ProductSource } from './contracts.js';
import { artifactDigest } from './production-contracts.js';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export type ManufacturerAcquisitionProfileStatus = 'proposed' | 'reviewed';
export type EmbeddedJsonRepresentation = 'embedded_json' | 'application_state';

export interface ManufacturerAcquisitionProfile {
  readonly schema_version: string;
  readonly id: string;
  readonly profile_status: ManufacturerAcquisitionProfileStatus;
  readonly manufacturer: string;
  readonly publisher: string;
  readonly official_domains: readonly string[];
  readonly approved_subdomains?: readonly string[];
  readonly allowed_document_domains?: readonly string[];
  readonly allowed_document_subdomains?: readonly string[];
  readonly strategies: readonly ManufacturerAcquisitionStrategy[];
  readonly provenance: {
    readonly source_artifact: string;
    readonly observed_source_content_hash: string;
  };
}

/**
 * Identifies the reviewed executable configuration without binding source-file
 * location or other provenance metadata to the acquisition run.
 */
export const manufacturerAcquisitionProfileDigest = (
  profile: ManufacturerAcquisitionProfile,
): string => {
  const { provenance: _provenance, ...configuration } = profile;
  return artifactDigest(configuration);
};

export interface ManufacturerAcquisitionStrategy {
  readonly id: string;
  readonly status: ManufacturerAcquisitionProfileStatus;
  readonly reference_uri?: string;
  readonly path_prefix: string;
  readonly embedded_json: {
    readonly representation: EmbeddedJsonRepresentation;
    readonly script: {
      readonly id: string;
      readonly media_type: 'application/json' | 'application/ld+json';
    };
    readonly json_path: string;
    readonly record_collection_path: string;
    readonly identity_property: string;
    readonly fact_mappings?: readonly StructuredFactMapping[];
  };
  readonly document_link_discovery: {
    readonly link_attribute: 'href';
    readonly allowed_extensions: readonly string[];
    readonly path_prefix: string;
    readonly document_urls?: readonly string[];
    readonly role_hints?: readonly {
      readonly pattern: string;
      readonly role:
        | 'product_page'
        | 'datasheet'
        | 'manual'
        | 'installation_manual'
        | 'technical_manual'
        | 'specification_sheet'
        | 'technical_drawing'
        | 'dimensional_drawing'
        | 'support_article'
        | 'certificate'
        | 'firmware_document'
        | 'unknown';
    }[];
    readonly expected_content?: readonly (
      | {
          readonly kind: 'text_includes';
          readonly value: string;
          readonly case_sensitive?: boolean;
        }
      | { readonly kind: 'json_path_exists'; readonly path: string }
    )[];
  };
}

export interface StructuredFactMapping {
  readonly source_path: string;
  readonly raw_label: string;
  readonly source_unit?: string;
}

export type ManufacturerAcquisitionStrategyResolution =
  | { readonly status: 'resolved'; readonly strategy: ManufacturerAcquisitionStrategy }
  | { readonly status: 'none'; readonly path: string }
  | {
      readonly status: 'ambiguous';
      readonly path: string;
      readonly strategy_ids: readonly string[];
    };

export interface ManufacturerAcquisitionIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ManufacturerAcquisitionValidation {
  readonly status: 'valid' | 'invalid';
  readonly issues: readonly ManufacturerAcquisitionIssue[];
  readonly ok: boolean;
}

export interface ProposedManufacturerAcquisitionProfileResult extends ManufacturerAcquisitionValidation {
  readonly proposed_profile?: ManufacturerAcquisitionProfile;
}

export interface ManufacturerAcquisitionRequest {
  readonly profile: ManufacturerAcquisitionProfile;
  readonly source_id: string;
  readonly requested_identity: ProductIdentityClaim;
  readonly captured_source: CapturedSource;
}

export interface DiscoveredDocumentLink {
  readonly uri: string;
  readonly locator: {
    readonly attribute: 'href';
    readonly link_index: number;
  };
}

export interface RawStructuredEvidence {
  readonly source: ProductSource;
  readonly source_id: string;
  readonly uri: string;
  readonly content_hash?: string;
  readonly representation: EmbeddedJsonRepresentation;
  readonly locator: {
    readonly script_id: string;
    readonly json_path: string;
    readonly record_collection_path: string;
    readonly record_index: number;
  };
  readonly raw_properties: JsonObject;
  readonly raw_record: JsonObject;
  readonly requested_identity: ProductIdentityClaim;
  readonly matched_identity: {
    readonly property: string;
    readonly raw_value: string;
  };
}

interface AcquisitionBaseResult {
  readonly profile_id: string;
  readonly documents: readonly DiscoveredDocumentLink[];
  readonly issues: readonly ManufacturerAcquisitionIssue[];
}

export interface MatchedManufacturerAcquisitionResult extends AcquisitionBaseResult {
  readonly status: 'matched';
  readonly source: ProductSource;
  readonly raw_structured_evidence: RawStructuredEvidence;
}

export interface UnmatchedManufacturerAcquisitionResult extends AcquisitionBaseResult {
  readonly status: 'unmatched';
  readonly source: ProductSource;
}

export interface AmbiguousManufacturerAcquisitionResult extends AcquisitionBaseResult {
  readonly status: 'ambiguous';
  readonly source: ProductSource;
  readonly matching_record_locators: readonly RawStructuredEvidence['locator'][];
}

export interface InvalidManufacturerAcquisitionResult extends AcquisitionBaseResult {
  readonly status: 'invalid';
}

export type ManufacturerAcquisitionResult =
  | MatchedManufacturerAcquisitionResult
  | UnmatchedManufacturerAcquisitionResult
  | AmbiguousManufacturerAcquisitionResult
  | InvalidManufacturerAcquisitionResult;

export type ManufacturerProfileResolution =
  | { readonly status: 'resolved'; readonly profile: ManufacturerAcquisitionProfile }
  | {
      readonly status: 'unknown_manufacturer';
      readonly manufacturer?: string;
      readonly generic_discovery_required: true;
      readonly review_required: true;
    }
  | {
      readonly status: 'ambiguous_manufacturer';
      readonly manufacturer: string;
      readonly profile_ids: readonly string[];
    };

type Validator = ((_value: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string; keyword?: string }>;
};

const AjvCtor = Ajv2020 as unknown as new (options?: Record<string, unknown>) => {
  compile: (_value: unknown) => Validator;
};
const ajv = new AjvCtor({ allErrors: true, strict: false });
const registerFormats = addFormats as unknown as (instance: {
  addFormat?: (...args: unknown[]) => void;
}) => void;
registerFormats(ajv as unknown as { addFormat?: (...args: unknown[]) => void });
const profileValidator = ajv.compile(profileSchema);

const forbiddenProfileSemanticKeys = new Set([
  'capabilities',
  'ports',
  'power_paths',
  'canonical_mapping',
  'canonical_mappings',
  'engineering',
  'engineering_rules',
  'scoring',
  'advisory',
  'advisories',
]);
const forbiddenJsonPathProperties = new Set(['__proto__', 'constructor', 'prototype']);
const profileIdCompare = (left: { readonly id: string }, right: { readonly id: string }): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
const issueCompare = (
  left: ManufacturerAcquisitionIssue,
  right: ManufacturerAcquisitionIssue,
): number =>
  left.path === right.path
    ? left.code === right.code
      ? left.message < right.message
        ? -1
        : left.message > right.message
          ? 1
          : 0
      : left.code < right.code
        ? -1
        : 1
    : left.path < right.path
      ? -1
      : 1;
const issue = (code: string, path: string, message: string): ManufacturerAcquisitionIssue => ({
  code,
  path,
  message,
});
const isJsonObject = (value: JsonValue | unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = (node: ChildNode): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(textOf).join('') : '';

const walk = (node: ParentNode, visit: (node: Element) => void): void => {
  for (const child of node.childNodes) {
    if (!('tagName' in child)) continue;
    visit(child);
    walk(child, visit);
  }
};

const attribute = (element: Element, name: string): string | undefined =>
  element.attrs.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value;

const parseJsonPath = (path: string): readonly (string | number)[] | undefined => {
  if (!path.startsWith('$')) return undefined;
  const tokens: (string | number)[] = [];
  let index = 1;
  while (index < path.length) {
    if (path[index] === '.') {
      const match = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(path.slice(index + 1));
      if (!match || forbiddenJsonPathProperties.has(match[0])) return undefined;
      tokens.push(match[0]);
      index += match[0].length + 1;
      continue;
    }
    if (path[index] === '[') {
      const match = /^\[(0|[1-9][0-9]*)\]/.exec(path.slice(index));
      if (!match) return undefined;
      tokens.push(Number(match[1]));
      index += match[0].length;
      continue;
    }
    return undefined;
  }
  return tokens;
};

const isSafeJsonPath = (path: unknown): path is string =>
  typeof path === 'string' && parseJsonPath(path) !== undefined;

const isOfficialUriForDomains = (domains: readonly string[], uri: string): boolean => {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === 'https:' && domains.some((domain) => domain === parsed.hostname);
  } catch {
    return false;
  }
};

const isUriForProfileDomains = (
  domains: readonly string[],
  subdomains: readonly string[],
  uri: string,
): boolean => {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return (
      domains.some((domain) => domain.toLowerCase().replace(/\.$/, '') === host) ||
      subdomains.some((domain) => {
        const root = domain.toLowerCase().replace(/^\./, '').replace(/\.$/, '');
        return host === root || host.endsWith(`.${root}`);
      })
    );
  } catch {
    return false;
  }
};

const normalizeScriptMediaType = (value: string): string =>
  value.trim().toLowerCase().split(';', 1)[0].trim();

const matchesScriptMediaType = (expected: string, actual: string | undefined): boolean => {
  const normalizedExpected = normalizeScriptMediaType(expected);
  const normalizedActual = actual ? normalizeScriptMediaType(actual) : undefined;
  if (!normalizedActual) return false;
  if (normalizedActual === normalizedExpected) return true;
  return (
    (normalizedExpected === 'application/json' && normalizedActual === 'application/ld+json') ||
    (normalizedExpected === 'application/ld+json' && normalizedActual === 'application/json')
  );
};

export const normalizeManufacturerIdentity = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

export const selectJsonPath = (value: JsonValue, path: string): JsonValue | undefined => {
  const tokens = parseJsonPath(path);
  if (!tokens) return undefined;
  let selected: JsonValue = value;
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(selected) || token >= selected.length) return undefined;
      selected = selected[token];
    } else {
      if (!isJsonObject(selected) || !Object.hasOwn(selected, token)) return undefined;
      selected = selected[token];
    }
  }
  return selected;
};

const semanticKeysIn = (value: unknown, path = ''): readonly string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (Array.isArray(value))
      return value.flatMap((item, index) => semanticKeysIn(item, `${path}[${index}]`));
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(forbiddenProfileSemanticKeys.has(key) ? [`${path}.${key}`] : []),
    ...semanticKeysIn(child, `${path}.${key}`),
  ]);
};

const schemaIssues = (): ManufacturerAcquisitionIssue[] =>
  profileValidator.errors?.map((error) =>
    issue(
      `schema_${error.keyword ?? 'invalid'}`,
      error.instancePath || '/',
      error.message ?? 'does not match the manufacturer acquisition profile schema.',
    ),
  ) ?? [];

export const validateManufacturerAcquisitionProfile = (
  profile: unknown,
): ManufacturerAcquisitionValidation => {
  const issues = profileValidator(profile) ? [] : schemaIssues();
  semanticKeysIn(profile).forEach((path) =>
    issues.push(
      issue(
        'forbidden_profile_semantics',
        path,
        'Acquisition profiles contain source mechanics only and cannot contain product or engineering semantics.',
      ),
    ),
  );
  const domains =
    isJsonObject(profile) && Array.isArray(profile.official_domains)
      ? profile.official_domains.filter((domain): domain is string => typeof domain === 'string')
      : [];
  if (isJsonObject(profile) && Array.isArray(profile.strategies)) {
    const strategyIds = profile.strategies
      .filter(isJsonObject)
      .map((strategy) => strategy.id)
      .filter((id): id is string => typeof id === 'string');
    if (strategyIds.join('\u0000') !== [...strategyIds].sort().join('\u0000')) {
      issues.push(
        issue(
          'unordered_strategies',
          'strategies',
          'Strategies must be in deterministic lexical order.',
        ),
      );
    }
    profile.strategies.forEach((strategy, index) => {
      if (!isJsonObject(strategy)) return;
      if (isJsonObject(strategy.embedded_json)) {
        for (const key of ['json_path', 'record_collection_path'] as const) {
          if (!isSafeJsonPath(strategy.embedded_json[key])) {
            issues.push(
              issue(
                'unsafe_json_path',
                `strategies[${index}].embedded_json.${key}`,
                'JSON selectors must use the supported declarative property and array-index path syntax.',
              ),
            );
          }
        }
      }
      if (
        typeof strategy.reference_uri === 'string' &&
        !isOfficialUriForDomains(domains, strategy.reference_uri)
      ) {
        issues.push(
          issue(
            'strategy_reference_not_official',
            `strategies[${index}].reference_uri`,
            'Strategy references must use a configured official HTTPS domain.',
          ),
        );
      }
      if (typeof strategy.reference_uri === 'string' && typeof strategy.path_prefix === 'string') {
        try {
          if (!new URL(strategy.reference_uri).pathname.startsWith(strategy.path_prefix)) {
            issues.push(
              issue(
                'strategy_reference_path_mismatch',
                `strategies[${index}].path_prefix`,
                'The strategy reference URI must match its path prefix.',
              ),
            );
          }
        } catch {
          // The JSON schema reports malformed URI values.
        }
      }
      if (isJsonObject(strategy.document_link_discovery)) {
        const extensions = strategy.document_link_discovery.allowed_extensions;
        if (Array.isArray(extensions)) {
          const values = extensions.filter(
            (extension): extension is string => typeof extension === 'string',
          );
          if (values.join('\u0000') !== [...values].sort().join('\u0000')) {
            issues.push(
              issue(
                'unordered_document_extensions',
                `strategies[${index}].document_link_discovery.allowed_extensions`,
                'Document extensions must be in deterministic lexical order.',
              ),
            );
          }
        }
      }
    });
  }
  if (isJsonObject(profile) && Array.isArray(profile.official_domains)) {
    if (domains.join('\u0000') !== [...domains].sort().join('\u0000')) {
      issues.push(
        issue(
          'unordered_official_domains',
          'official_domains',
          'Official domains must be in deterministic lexical order.',
        ),
      );
    }
    for (const field of [
      'approved_subdomains',
      'allowed_document_domains',
      'allowed_document_subdomains',
    ] as const) {
      if (isJsonObject(profile) && Array.isArray(profile[field])) {
        const values = profile[field].filter((value): value is string => typeof value === 'string');
        if (values.join('\u0000') !== [...values].sort().join('\u0000')) {
          issues.push(
            issue(`unordered_${field}`, field, `${field} must be in deterministic lexical order.`),
          );
        }
      }
    }
  }
  const sortedIssues = [...issues].sort(issueCompare);
  return {
    status: sortedIssues.length ? 'invalid' : 'valid',
    issues: sortedIssues,
    ok: sortedIssues.length === 0,
  };
};

export const buildProposedManufacturerAcquisitionProfile = (
  profile: unknown,
): ProposedManufacturerAcquisitionProfileResult => {
  const validation = validateManufacturerAcquisitionProfile(profile);
  const issues = [...validation.issues];
  if (!isJsonObject(profile) || profile.profile_status !== 'proposed') {
    issues.push(
      issue(
        'profile_not_proposed',
        'profile_status',
        'Only profiles explicitly marked proposed can be built through the proposed-profile boundary.',
      ),
    );
  }
  const sortedIssues = issues.sort(issueCompare);
  return {
    status: sortedIssues.length ? 'invalid' : 'valid',
    issues: sortedIssues,
    ok: sortedIssues.length === 0,
    ...(sortedIssues.length === 0
      ? { proposed_profile: profile as ManufacturerAcquisitionProfile }
      : {}),
  };
};

export const resolveManufacturerAcquisitionProfile = (
  profiles: readonly ManufacturerAcquisitionProfile[],
  identity: Pick<ProductIdentityClaim, 'manufacturer'>,
): ManufacturerProfileResolution => {
  if (!identity.manufacturer) {
    return {
      status: 'unknown_manufacturer',
      generic_discovery_required: true,
      review_required: true,
    };
  }
  const normalizedManufacturer = normalizeManufacturerIdentity(identity.manufacturer);
  const matches = profiles
    .filter(
      (profile) =>
        profile.profile_status === 'reviewed' &&
        normalizeManufacturerIdentity(profile.manufacturer) === normalizedManufacturer,
    )
    .sort(profileIdCompare);
  if (matches.length === 0) {
    return {
      status: 'unknown_manufacturer',
      manufacturer: identity.manufacturer,
      generic_discovery_required: true,
      review_required: true,
    };
  }
  if (matches.length > 1) {
    return {
      status: 'ambiguous_manufacturer',
      manufacturer: identity.manufacturer,
      profile_ids: matches.map((profile) => profile.id),
    };
  }
  return { status: 'resolved', profile: matches[0] };
};

export const isOfficialManufacturerUri = (
  profile: ManufacturerAcquisitionProfile,
  uri: string,
): boolean =>
  isUriForProfileDomains(profile.official_domains, profile.approved_subdomains ?? [], uri);

export const resolveManufacturerAcquisitionStrategy = (
  profile: ManufacturerAcquisitionProfile,
  uri: string,
): ManufacturerAcquisitionStrategyResolution => {
  try {
    const path = new URL(uri).pathname;
    const applicable = profile.strategies
      .filter((strategy) => strategy.status === 'reviewed' && path.startsWith(strategy.path_prefix))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    if (applicable.length === 0) return { status: 'none', path };
    if (applicable.length > 1) {
      return { status: 'ambiguous', path, strategy_ids: applicable.map((strategy) => strategy.id) };
    }
    return { status: 'resolved', strategy: applicable[0] };
  } catch {
    return { status: 'none', path: '' };
  }
};

const sourceFor = (
  request: ManufacturerAcquisitionRequest,
  applicability: ProductSource['applicability'],
): ProductSource =>
  ({
    ...createProductSource(request.captured_source, {
      id: request.source_id,
      source_type: 'manufacturer_product_page',
      authority: 'manufacturer_product',
      publisher: request.profile.publisher,
      manufacturer: request.profile.manufacturer,
      schema_version: request.profile.schema_version,
    }),
    applicability,
    product_identity_claim: request.requested_identity,
    redistribution_status: 'link_only',
  }) as ProductSource;

export const discoverOfficialDocuments = (
  profile: ManufacturerAcquisitionProfile,
  strategy: ManufacturerAcquisitionStrategy,
  captured: CapturedSource,
): readonly DiscoveredDocumentLink[] => {
  if (
    !captured.body.text ||
    !isOfficialManufacturerUri(profile, captured.final_uri) ||
    !new URL(captured.final_uri).pathname.startsWith(strategy.path_prefix)
  ) {
    return [];
  }
  const document = parse(captured.body.text) as Document;
  const links: DiscoveredDocumentLink[] = [];
  let linkIndex = 0;
  walk(document, (element) => {
    if (element.tagName !== 'a') return;
    const currentIndex = linkIndex;
    linkIndex += 1;
    const rawHref = attribute(element, strategy.document_link_discovery.link_attribute);
    if (!rawHref) return;
    let uri: URL;
    try {
      uri = new URL(rawHref, captured.final_uri);
    } catch {
      return;
    }
    if (
      !isOfficialManufacturerUri(profile, uri.toString()) ||
      !uri.pathname.startsWith(strategy.document_link_discovery.path_prefix) ||
      !strategy.document_link_discovery.allowed_extensions.some((extension) =>
        uri.pathname.toLowerCase().endsWith(extension.toLowerCase()),
      )
    ) {
      return;
    }
    links.push({ uri: uri.toString(), locator: { attribute: 'href', link_index: currentIndex } });
  });
  return links.sort((left, right) => (left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0));
};

const embeddedPayload = (
  strategy: ManufacturerAcquisitionStrategy,
  captured: CapturedSource,
): { readonly payload?: JsonValue; readonly issues: readonly ManufacturerAcquisitionIssue[] } => {
  if (captured.body.text === undefined) {
    return {
      issues: [
        issue('missing_text_body', 'captured_source.body.text', 'HTML acquisition requires text.'),
      ],
    };
  }
  const document = parse(captured.body.text) as Document;
  let rawJson: string | undefined;
  walk(document, (element) => {
    if (rawJson !== undefined || element.tagName !== 'script') return;
    if (
      attribute(element, 'id') === strategy.embedded_json.script.id &&
      matchesScriptMediaType(strategy.embedded_json.script.media_type, attribute(element, 'type'))
    ) {
      rawJson = textOf(element);
    }
  });
  if (rawJson === undefined) {
    return {
      issues: [
        issue(
          'embedded_json_not_found',
          'embedded_json.script',
          'The configured JSON script was not present in the captured source.',
        ),
      ],
    };
  }
  try {
    return { payload: JSON.parse(rawJson) as JsonValue, issues: [] };
  } catch {
    return {
      issues: [
        issue(
          'embedded_json_invalid',
          'embedded_json.script',
          'The configured JSON script did not contain valid JSON.',
        ),
      ],
    };
  }
};

const stableValue = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : item,
  );

export const serializeManufacturerAcquisitionResult = (
  result: ManufacturerAcquisitionResult,
): string => stableValue(result);

export const acquireManufacturerRecord = (
  request: ManufacturerAcquisitionRequest,
): ManufacturerAcquisitionResult => {
  const validation = validateManufacturerAcquisitionProfile(request.profile);
  let base: AcquisitionBaseResult = {
    profile_id: request.profile.id,
    documents: [],
    issues: [],
  };
  if (!validation.ok) return { status: 'invalid', ...base, issues: validation.issues };
  if (request.profile.profile_status !== 'reviewed') {
    return {
      status: 'invalid',
      ...base,
      issues: [
        issue(
          'profile_not_reviewed',
          'profile_status',
          'Acquisition executes only reviewed manufacturer acquisition profiles.',
        ),
      ],
    };
  }
  if (!request.requested_identity.manufacturer_part_number) {
    return {
      status: 'invalid',
      ...base,
      issues: [
        issue(
          'requested_identity_missing_part_number',
          'requested_identity.manufacturer_part_number',
          'Exact raw acquisition requires a requested manufacturer part number.',
        ),
      ],
    };
  }
  if (!request.captured_source.media_type?.toLowerCase().includes('html')) {
    return {
      status: 'invalid',
      ...base,
      issues: [
        issue(
          'unsupported_source_media_type',
          'captured_source.media_type',
          'Embedded JSON acquisition requires an HTML captured source.',
        ),
      ],
    };
  }
  if (request.requested_identity.manufacturer !== request.profile.manufacturer) {
    return {
      status: 'invalid',
      ...base,
      issues: [
        issue(
          'manufacturer_profile_mismatch',
          'requested_identity.manufacturer',
          'The requested manufacturer must exactly match the reviewed profile manufacturer.',
        ),
      ],
    };
  }
  if (
    !isOfficialManufacturerUri(request.profile, request.captured_source.requested_uri) ||
    !isOfficialManufacturerUri(request.profile, request.captured_source.final_uri)
  ) {
    return {
      status: 'invalid',
      ...base,
      issues: [
        issue(
          'official_domain_required',
          'captured_source',
          'Both the requested and final source URI must use a configured official HTTPS domain.',
        ),
      ],
    };
  }
  const requestedStrategy = resolveManufacturerAcquisitionStrategy(
    request.profile,
    request.captured_source.requested_uri,
  );
  const finalStrategy = resolveManufacturerAcquisitionStrategy(
    request.profile,
    request.captured_source.final_uri,
  );
  if (
    requestedStrategy.status !== 'resolved' ||
    finalStrategy.status !== 'resolved' ||
    requestedStrategy.strategy.id !== finalStrategy.strategy.id
  ) {
    return {
      status: 'invalid',
      ...base,
      issues: [
        issue(
          requestedStrategy.status === 'ambiguous' || finalStrategy.status === 'ambiguous'
            ? 'strategy_ambiguous'
            : 'strategy_not_found',
          'captured_source.final_uri',
          'The captured source does not resolve to exactly one reviewed acquisition strategy.',
        ),
      ],
    };
  }
  const strategy = finalStrategy.strategy;
  base = {
    profile_id: request.profile.id,
    documents: discoverOfficialDocuments(request.profile, strategy, request.captured_source),
    issues: [],
  };
  const payloadResult = embeddedPayload(strategy, request.captured_source);
  if (!payloadResult.payload) return { status: 'invalid', ...base, issues: payloadResult.issues };
  const scopedPayload = selectJsonPath(payloadResult.payload, strategy.embedded_json.json_path);
  const records = scopedPayload
    ? selectJsonPath(scopedPayload, strategy.embedded_json.record_collection_path)
    : undefined;
  if (!Array.isArray(records)) {
    return {
      status: 'invalid',
      ...base,
      issues: [
        issue(
          'record_collection_not_found',
          'strategies[].embedded_json.record_collection_path',
          'The configured record collection was not an array in the captured JSON payload.',
        ),
      ],
    };
  }
  const matchingRecords = records
    .map((record, record_index) => ({ record, record_index }))
    .filter(
      (item): item is { readonly record: JsonObject; readonly record_index: number } =>
        isJsonObject(item.record) &&
        item.record[strategy.embedded_json.identity_property] ===
          request.requested_identity.manufacturer_part_number,
    )
    .sort((left, right) => {
      const leftValue = stableValue(left.record);
      const rightValue = stableValue(right.record);
      return leftValue < rightValue
        ? -1
        : leftValue > rightValue
          ? 1
          : left.record_index - right.record_index;
    });
  if (matchingRecords.length === 0) {
    return {
      status: 'unmatched',
      ...base,
      source: sourceFor(request, 'unresolved'),
      issues: [
        issue(
          'raw_identity_unmatched',
          'requested_identity.manufacturer_part_number',
          'No raw record exactly matched the requested manufacturer part number.',
        ),
      ],
    };
  }
  if (matchingRecords.length > 1) {
    return {
      status: 'ambiguous',
      ...base,
      source: sourceFor(request, 'unresolved'),
      matching_record_locators: matchingRecords.map(({ record_index }) => ({
        script_id: strategy.embedded_json.script.id,
        json_path: strategy.embedded_json.json_path,
        record_collection_path: strategy.embedded_json.record_collection_path,
        record_index,
      })),
      issues: [
        issue(
          'raw_identity_ambiguous',
          'requested_identity.manufacturer_part_number',
          'Multiple raw records exactly matched the requested manufacturer part number.',
        ),
      ],
    };
  }
  const { record, record_index } = matchingRecords[0];
  const source = sourceFor(request, 'direct_identity');
  return {
    status: 'matched',
    ...base,
    source,
    raw_structured_evidence: {
      source,
      source_id: source.id,
      uri: source.uri,
      ...(source.content_hash ? { content_hash: source.content_hash } : {}),
      representation: strategy.embedded_json.representation,
      locator: {
        script_id: strategy.embedded_json.script.id,
        json_path: strategy.embedded_json.json_path,
        record_collection_path: strategy.embedded_json.record_collection_path,
        record_index,
      },
      raw_properties: record,
      raw_record: record,
      requested_identity: request.requested_identity,
      matched_identity: {
        property: strategy.embedded_json.identity_property,
        raw_value: request.requested_identity.manufacturer_part_number,
      },
    },
    issues: [],
  };
};
