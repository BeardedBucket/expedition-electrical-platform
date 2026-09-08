import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CaptureIssue,
  CaptureRequest,
  CapturedSource,
  SourceCaptureAdapter,
} from './capture-types.js';
import type { JsonObject, JsonValue } from './contracts.js';
import {
  PRODUCTION_HASH_ALGORITHM,
  PRODUCTION_SCHEMA_VERSION,
  type ArtifactReference,
  type CaptureReasonCode,
  type CaptureDisposition,
  type RetentionStatus,
  type SourceCaptureArtifact,
} from './production-contracts.js';

const INSPECTION_LIMIT_BYTES = 64 * 1024;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SNAPSHOT_REFERENCE_PATTERN = /^snapshot:\/\/sha256\/([a-f0-9]{64})$/;

export type SourceReasonCode = CaptureReasonCode | 'snapshot_missing' | 'snapshot_read_failure';

export interface SourceCaptureReason {
  readonly code: SourceReasonCode;
  readonly message: string;
}

export type ExpectedContentAssertion =
  | {
      readonly kind: 'text_includes';
      readonly value: string;
      readonly case_sensitive?: boolean;
    }
  | {
      readonly kind: 'json_path_exists';
      readonly path: string;
    };

export interface SnapshotStoreRecord {
  readonly reference: string;
  readonly digest: string;
}

export interface SnapshotStore {
  writeSnapshot(bytes: Uint8Array, digest: string): Promise<SnapshotStoreRecord>;
  readSnapshot(reference: string): Promise<Uint8Array>;
}

export interface ProductionSourceCaptureRequest extends CaptureRequest {
  readonly capture_id: string;
  readonly retention_status: RetentionStatus;
  readonly expected_content?: readonly ExpectedContentAssertion[];
  readonly source_provenance?: JsonObject;
}

export interface ProductionSourceCaptureResult {
  readonly disposition: CaptureDisposition;
  readonly artifact: SourceCaptureArtifact;
  readonly source?: CapturedSource;
  readonly reasons: readonly SourceCaptureReason[];
}

export interface ReplaySourceCaptureResult {
  readonly status: 'replayed' | 'failed';
  readonly bytes?: Uint8Array;
  readonly issue?: SourceCaptureReason;
}

interface ContentClassification {
  readonly disposition: CaptureDisposition;
  readonly reasons: readonly SourceCaptureReason[];
  readonly expected_results: readonly {
    readonly assertion: ExpectedContentAssertion;
    readonly status: 'passed' | 'failed';
  }[];
}

const toReason = (captureIssue: CaptureIssue): SourceCaptureReason => ({
  code: captureIssue.code as CaptureReasonCode,
  message: captureIssue.message,
});

const hasAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

const hasAll = (haystack: string, needles: readonly string[]): boolean =>
  needles.every((needle) => haystack.includes(needle));

const decodeInspectionText = (source: CapturedSource): string => {
  if (source.body.text) return source.body.text.slice(0, INSPECTION_LIMIT_BYTES);
  return new TextDecoder().decode(
    source.body.bytes.subarray(0, Math.min(source.body.bytes.byteLength, INSPECTION_LIMIT_BYTES)),
  );
};

const stripHtml = (text: string): string =>
  text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const looksLikePdf = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 5 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d;

const looksLikeHtml = (text: string): boolean =>
  /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<main[\s>]|<div[\s>]/i.test(text);

const challengeReason = (html: string): SourceCaptureReason | undefined => {
  if (
    hasAny(html, ['cf-browser-verification', 'cf-chl-', '/cdn-cgi/challenge-platform']) ||
    (hasAll(html, ['cloudflare', 'checking your browser']) && hasAny(html, ['ray id', 'cf-ray']))
  ) {
    return {
      code: 'challenge_detected',
      message: 'The capture looks like an anti-bot challenge page.',
    };
  }
  if (
    hasAny(html, ['captcha', 'hcaptcha', 'recaptcha']) &&
    hasAny(html, ['verify you are human', 'human verification', 'robot'])
  ) {
    return {
      code: 'challenge_detected',
      message: 'The capture looks like a human verification page.',
    };
  }
  if (
    hasAny(html, ['access denied', 'forbidden']) &&
    hasAny(html, ['bot', 'automated request', 'verification required'])
  ) {
    return {
      code: 'challenge_detected',
      message: 'The capture looks like a blocked bot-verification page.',
    };
  }
  return undefined;
};

const authenticationReason = (html: string): SourceCaptureReason | undefined =>
  /<(form|input)[^>]+(password|login|log in|sign in)/i.test(html) ||
  (hasAny(html, ['sign in', 'log in', 'login']) && hasAny(html, ['password', 'account']))
    ? {
        code: 'authentication_wall',
        message: 'The capture requires authentication before product content is available.',
      }
    : undefined;

const consentReason = (html: string, wordCount: number): SourceCaptureReason | undefined =>
  hasAny(html, ['cookie consent', 'privacy preference center', 'consent preferences']) &&
  wordCount < 90
    ? {
        code: 'consent_interstitial',
        message: 'The capture looks like a consent/interstitial page instead of product content.',
      }
    : undefined;

const soft404Reason = (html: string, wordCount: number): SourceCaptureReason | undefined =>
  wordCount < 220 &&
  hasAny(html, [
    'page not found',
    'error 404',
    '404 not found',
    'product no longer available',
    'temporarily unavailable',
    'this item is unavailable',
  ])
    ? {
        code: 'soft_404',
        message: 'The capture looks like a soft-404 or unavailable-product page.',
      }
    : undefined;

const emptyShellReason = (html: string, wordCount: number): SourceCaptureReason | undefined =>
  wordCount === 0 ||
  (wordCount <= 3 &&
    /id=["'](root|app|__next)["']|data-reactroot|window\.__INITIAL_STATE__/i.test(html))
    ? {
        code: 'empty_content',
        message: 'The capture did not contain meaningful product content.',
      }
    : undefined;

const parseExpectedPath = (path: string): readonly (string | number)[] | undefined => {
  if (!path.startsWith('$')) return undefined;
  const tokens: (string | number)[] = [];
  let index = 1;
  while (index < path.length) {
    if (path[index] === '.') {
      const key = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(path.slice(index + 1));
      if (!key || key[0] === '__proto__' || key[0] === 'constructor' || key[0] === 'prototype')
        return undefined;
      tokens.push(key[0]);
      index += key[0].length + 1;
      continue;
    }
    if (path[index] === '[') {
      const position = /^\[(0|[1-9][0-9]*)\]/.exec(path.slice(index));
      if (!position) return undefined;
      tokens.push(Number(position[1]));
      index += position[0].length;
      continue;
    }
    return undefined;
  }
  return tokens;
};

const selectExpectedPath = (value: JsonValue, path: string): JsonValue | undefined => {
  const tokens = parseExpectedPath(path);
  if (!tokens) return undefined;
  let current: JsonValue = value;
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current) || token >= current.length) return undefined;
      current = current[token];
      continue;
    }
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (!Object.hasOwn(current, token)) return undefined;
    current = current[token] as JsonValue;
  }
  return current;
};

const evaluateExpectedContent = (
  source: CapturedSource,
  assertions: readonly ExpectedContentAssertion[],
): readonly {
  readonly assertion: ExpectedContentAssertion;
  readonly status: 'passed' | 'failed';
}[] => {
  if (assertions.length === 0) return [];
  const text = decodeInspectionText(source);
  const parsedJson: JsonValue | undefined = (() => {
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      return undefined;
    }
  })();
  return assertions.map((assertion) => {
    if (assertion.kind === 'text_includes') {
      const haystack = assertion.case_sensitive ? text : text.toLocaleLowerCase('en-US');
      const needle = assertion.case_sensitive
        ? assertion.value
        : assertion.value.toLocaleLowerCase('en-US');
      return { assertion, status: haystack.includes(needle) ? 'passed' : 'failed' } as const;
    }
    if (!parsedJson) return { assertion, status: 'failed' } as const;
    return {
      assertion,
      status: selectExpectedPath(parsedJson, assertion.path) === undefined ? 'failed' : 'passed',
    } as const;
  });
};

const classifySuccessfulCapture = (
  source: CapturedSource,
  expectedContent: readonly ExpectedContentAssertion[],
): ContentClassification => {
  if (source.body.bytes.byteLength === 0) {
    return {
      disposition: 'empty',
      reasons: [{ code: 'empty_content', message: 'The source body was empty.' }],
      expected_results: [],
    };
  }
  const mediaType = source.media_type?.toLowerCase();
  const inspectionText = decodeInspectionText(source);
  const pdf = looksLikePdf(source.body.bytes);
  const html = looksLikeHtml(inspectionText);
  const declaredPdf = mediaType === 'application/pdf';
  const declaredHtml = mediaType?.includes('html') || mediaType?.startsWith('text/');

  if (!mediaType) {
    return {
      disposition: 'non_authoritative',
      reasons: [
        {
          code: 'content_type_mismatch',
          message: 'The source did not provide a Content-Type header.',
        },
      ],
      expected_results: [],
    };
  }
  if (declaredPdf && !pdf) {
    return {
      disposition: 'non_authoritative',
      reasons: [
        {
          code: 'content_type_mismatch',
          message: 'The source declared application/pdf but bytes did not match PDF signature.',
        },
      ],
      expected_results: [],
    };
  }
  if (declaredHtml && pdf) {
    return {
      disposition: 'non_authoritative',
      reasons: [
        {
          code: 'content_type_mismatch',
          message: 'The source declared HTML/text but bytes looked like PDF.',
        },
      ],
      expected_results: [],
    };
  }
  if (!declaredPdf && !declaredHtml) {
    return {
      disposition: 'non_authoritative',
      reasons: [
        {
          code: 'content_type_mismatch',
          message: `The source media type '${mediaType}' is not yet authoritative for capture.`,
        },
      ],
      expected_results: [],
    };
  }
  if (declaredHtml) {
    if (!html) {
      return {
        disposition: 'non_authoritative',
        reasons: [
          {
            code: 'content_type_mismatch',
            message: 'The source declared HTML/text but the content did not look like HTML.',
          },
        ],
        expected_results: [],
      };
    }
    const normalized = inspectionText.toLocaleLowerCase('en-US');
    const plainText = stripHtml(inspectionText);
    const words = plainText.length ? plainText.split(/\s+/).length : 0;
    const htmlReason =
      challengeReason(normalized) ??
      authenticationReason(normalized) ??
      consentReason(normalized, words) ??
      soft404Reason(normalized, words) ??
      emptyShellReason(normalized, words);
    if (htmlReason) {
      return { disposition: 'non_authoritative', reasons: [htmlReason], expected_results: [] };
    }
  }

  const expectedResults = evaluateExpectedContent(source, expectedContent);
  const failedExpected = expectedResults.some((result) => result.status === 'failed');
  if (failedExpected) {
    return {
      disposition: 'non_authoritative',
      reasons: [
        {
          code: 'expected_content_missing',
          message: 'The capture did not satisfy one or more expected-content assertions.',
        },
      ],
      expected_results: expectedResults,
    };
  }
  return { disposition: 'authoritative', reasons: [], expected_results: expectedResults };
};

const digestOf = (bytes: Uint8Array): string =>
  `${PRODUCTION_HASH_ALGORITHM}:${createHash(PRODUCTION_HASH_ALGORITHM).update(bytes).digest('hex')}`;

const digestComponents = (digest: string): { readonly algorithm: string; readonly hex: string } => {
  if (!SHA256_DIGEST_PATTERN.test(digest)) {
    throw new Error(`Unsupported content digest '${digest}'.`);
  }
  const [_algorithm, hex] = digest.split(':');
  return { algorithm: PRODUCTION_HASH_ALGORITHM, hex };
};

const snapshotReferenceFor = (digest: string): string => {
  const { hex } = digestComponents(digest);
  return `snapshot://sha256/${hex}`;
};

const snapshotArtifactReference = (
  digest: string,
  reference: string,
): ArtifactReference<'source_capture'> => ({
  kind: 'source_capture',
  reference_schema_version: PRODUCTION_SCHEMA_VERSION,
  digest,
  digest_algorithm: PRODUCTION_HASH_ALGORITHM,
  reference,
});

const withCaptureProvenance = (
  base: JsonObject | undefined,
  transportStatus: CaptureResultStatus,
  reasons: readonly SourceCaptureReason[],
  expectedResults: ContentClassification['expected_results'],
  source?: CapturedSource,
): JsonObject | undefined => {
  const provenanceBase = Object.fromEntries(
    Object.entries(base ?? {}).filter(
      ([key]) => key !== 'redirect_chain' && key !== 'reason_codes',
    ),
  );
  const merged: JsonObject = {
    ...provenanceBase,
    capture_transport_status: transportStatus,
    ...(source?.metadata ? { response_metadata: source.metadata } : {}),
    ...(expectedResults.length
      ? {
          expected_content: expectedResults.map((result) => ({
            kind: result.assertion.kind,
            status: result.status,
            ...(result.assertion.kind === 'text_includes'
              ? { value: result.assertion.value }
              : { path: result.assertion.path }),
          })),
        }
      : {}),
  };
  return Object.keys(merged).length ? merged : undefined;
};

type CaptureResultStatus = 'success' | 'invalid' | 'failed';

const toArtifact = (
  request: ProductionSourceCaptureRequest,
  disposition: CaptureDisposition,
  retentionStatus: RetentionStatus,
  reasons: readonly SourceCaptureReason[],
  expectedResults: ContentClassification['expected_results'],
  source: CapturedSource | undefined,
  snapshot: ArtifactReference<'source_capture'> | undefined,
  transportStatus: CaptureResultStatus,
  now: () => string,
): SourceCaptureArtifact => ({
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'source_capture',
  id: request.capture_id,
  requested_uri: request.uri,
  ...(source?.final_uri ? { final_uri: source.final_uri } : {}),
  retrieved_at: source?.retrieved_at ?? request.retrieved_at ?? now(),
  ...(source?.media_type ? { media_type: source.media_type } : {}),
  ...(source?.response_status !== undefined ? { response_status: source.response_status } : {}),
  disposition,
  ...(source?.redirect_chain?.length ? { redirect_chain: source.redirect_chain } : {}),
  ...(reasons.length
    ? { reason_codes: reasons.map((reason) => reason.code as CaptureReasonCode) }
    : {}),
  ...(source?.content_hash ? { content_digest: source.content_hash } : {}),
  ...(source?.content_hash ? { digest_algorithm: PRODUCTION_HASH_ALGORITHM } : {}),
  ...(snapshot ? { snapshot } : {}),
  retention_status: retentionStatus,
  ...(withCaptureProvenance(
    request.source_provenance,
    transportStatus,
    reasons,
    expectedResults,
    source,
  )
    ? {
        source_provenance: withCaptureProvenance(
          request.source_provenance,
          transportStatus,
          reasons,
          expectedResults,
          source,
        ),
      }
    : {}),
  ...(source?.metadata?.etag ? { etag: source.metadata.etag } : {}),
  ...(source?.metadata?.['last-modified']
    ? { last_modified: source.metadata['last-modified'] }
    : {}),
});

const isCapturedContentDisposition = (value: CaptureDisposition): boolean =>
  value === 'authoritative' || value === 'non_authoritative';

export const compareCaptureContent = (
  leftDigest: string | undefined,
  rightDigest: string | undefined,
): 'same_content' | 'changed_content' | 'unknown' => {
  if (!leftDigest || !rightDigest) return 'unknown';
  return leftDigest === rightDigest ? 'same_content' : 'changed_content';
};

export class LocalSnapshotStore implements SnapshotStore {
  public constructor(private readonly root_directory: string) {}

  private digestPath(digest: string): string {
    const { algorithm, hex } = digestComponents(digest);
    return join(this.root_directory, algorithm, hex.slice(0, 2), `${hex}.bin`);
  }

  private digestFromReference(reference: string): string {
    const match = SNAPSHOT_REFERENCE_PATTERN.exec(reference);
    if (!match) throw new Error(`Unsupported snapshot reference '${reference}'.`);
    return `${PRODUCTION_HASH_ALGORITHM}:${match[1]}`;
  }

  public resolveSnapshotPath(reference: string): string {
    const digest = this.digestFromReference(reference);
    return this.digestPath(digest);
  }

  public async writeSnapshot(bytes: Uint8Array, digest: string): Promise<SnapshotStoreRecord> {
    const expectedDigest = digestComponents(digest);
    const actualDigest = digestOf(bytes);
    if (actualDigest !== digest) {
      throw new Error(
        `snapshot_digest_mismatch expected ${digest} but computed ${actualDigest} from payload`,
      );
    }
    const path = this.digestPath(digest);
    await mkdir(
      join(this.root_directory, expectedDigest.algorithm, expectedDigest.hex.slice(0, 2)),
      {
        recursive: true,
      },
    );
    try {
      await writeFile(path, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = new Uint8Array(await readFile(path));
      if (digestOf(existing) !== digest) {
        throw new Error(`snapshot_digest_mismatch existing bytes do not match ${digest}`);
      }
    }
    return { reference: snapshotReferenceFor(digest), digest };
  }

  public async readSnapshot(reference: string): Promise<Uint8Array> {
    const path = this.resolveSnapshotPath(reference);
    return new Uint8Array(await readFile(path));
  }
}

export const captureSourceForProduction = async (
  adapter: SourceCaptureAdapter,
  request: ProductionSourceCaptureRequest,
  options: {
    readonly snapshot_store?: SnapshotStore;
    readonly now?: () => string;
  } = {},
): Promise<ProductionSourceCaptureResult> => {
  const now = options.now ?? (() => new Date().toISOString());
  const transport = await adapter.capture(request);
  const transportReasons = transport.issues.map(toReason);

  if (transport.status !== 'success' || transport.source === undefined) {
    const retentionStatus =
      request.retention_status === 'retained' ? 'unknown' : request.retention_status;
    const artifact = toArtifact(
      request,
      'failed',
      retentionStatus,
      transportReasons.length
        ? transportReasons
        : [{ code: 'network_error', message: 'Capture did not produce source content.' }],
      [],
      transport.source,
      undefined,
      transport.status,
      now,
    );
    return {
      disposition: 'failed',
      artifact,
      ...(transport.source ? { source: transport.source } : {}),
      reasons:
        transportReasons.length > 0
          ? transportReasons
          : [{ code: 'network_error', message: 'Capture did not produce source content.' }],
    };
  }

  const classification = classifySuccessfulCapture(
    transport.source,
    request.expected_content ?? ([] as const),
  );
  const combinedReasons = [...transportReasons, ...classification.reasons];
  let disposition = classification.disposition;
  let retentionStatus: RetentionStatus = request.retention_status;
  let snapshot: ArtifactReference<'source_capture'> | undefined;

  if (isCapturedContentDisposition(disposition) && !transport.source.content_hash) {
    disposition = 'failed';
    combinedReasons.push({
      code: 'snapshot_digest_mismatch',
      message: 'Captured bytes were missing a content digest.',
    });
  }

  if (request.retention_status === 'retained' && isCapturedContentDisposition(disposition)) {
    if (!options.snapshot_store || !transport.source.content_hash) {
      disposition = 'failed';
      retentionStatus = 'unknown';
      combinedReasons.push({
        code: 'snapshot_write_failure',
        message: 'Retention required a snapshot store but none was available.',
      });
    } else {
      try {
        const persisted = await options.snapshot_store.writeSnapshot(
          transport.source.body.bytes,
          transport.source.content_hash,
        );
        snapshot = snapshotArtifactReference(persisted.digest, persisted.reference);
      } catch (error) {
        disposition = 'failed';
        retentionStatus = 'unknown';
        combinedReasons.push({
          code: String(error).includes('snapshot_digest_mismatch')
            ? 'snapshot_digest_mismatch'
            : 'snapshot_write_failure',
          message: String(error),
        });
      }
    }
  }

  if (request.retention_status === 'retained' && disposition !== 'authoritative' && !snapshot) {
    retentionStatus = 'unknown';
  }

  const artifact = toArtifact(
    request,
    disposition,
    retentionStatus,
    combinedReasons,
    classification.expected_results,
    transport.source,
    snapshot,
    transport.status,
    now,
  );
  return {
    disposition,
    artifact,
    source: transport.source,
    reasons: combinedReasons,
  };
};

export const replaySourceCaptureSnapshot = async (
  capture: Pick<SourceCaptureArtifact, 'content_digest' | 'snapshot'>,
  snapshotStore: SnapshotStore,
): Promise<ReplaySourceCaptureResult> => {
  if (!capture.snapshot?.reference) {
    return {
      status: 'failed',
      issue: {
        code: 'snapshot_missing',
        message: 'The capture artifact does not reference a retained snapshot.',
      },
    };
  }
  if (!capture.content_digest) {
    return {
      status: 'failed',
      issue: {
        code: 'snapshot_digest_mismatch',
        message: 'The capture artifact is missing content digest metadata.',
      },
    };
  }
  try {
    const bytes = await snapshotStore.readSnapshot(capture.snapshot.reference);
    const actualDigest = digestOf(bytes);
    if (actualDigest !== capture.content_digest) {
      return {
        status: 'failed',
        issue: {
          code: 'snapshot_digest_mismatch',
          message: `Expected ${capture.content_digest} but snapshot resolved as ${actualDigest}.`,
        },
      };
    }
    return { status: 'replayed', bytes };
  } catch (error) {
    return {
      status: 'failed',
      issue: {
        code: 'snapshot_read_failure',
        message: String(error),
      },
    };
  }
};
