import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type {
  CaptureRequest,
  CaptureResult,
  RedirectHop,
  SourceCaptureAdapter,
} from './capture-types.js';

export const DEFAULT_MAX_BYTES = 2_000_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_REDIRECTS = 5;

const issue = (code: string, message: string) => ({ code, message });
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HASH_ALGORITHM = 'sha256';

export type HostAddressResolver = (hostname: string) => Promise<readonly string[]>;

const normalizeHost = (hostname: string): string => hostname.toLowerCase().replace(/^\[|\]$/g, '');

const isBlockedIp = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(normalized);
  if (version === 0) return false;
  if (version === 4) {
    const octets = normalized.split('.').map(Number);
    if (octets[0] >= 224) return true;
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 0 && octets[1] === 0 && octets[2] === 0 && octets[3] === 0) ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 0 && octets[2] === 0) ||
      (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
      (octets[0] === 192 && octets[1] === 88 && octets[2] === 99) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) ||
      (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
      (octets[0] === 203 && octets[1] === 0 && octets[2] === 113)
    );
  }
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIp(normalized.slice('::ffff:'.length));
  }
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
};

const isBlockedHost = (hostname: string): boolean => {
  const normalized = normalizeHost(hostname);
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  return isBlockedIp(normalized);
};

const resolveHostAddresses: HostAddressResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((record) => record.address);
};

const normalizeResponseHeaders = (headers: Headers): Readonly<Record<string, string>> => {
  const entries = Array.from(headers.entries()).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return Object.freeze(Object.fromEntries(entries));
};

const mediaTypeFrom = (headers: Readonly<Record<string, string>>): string | undefined => {
  const value = headers['content-type'];
  const normalized = value?.split(';', 1)[0]?.trim().toLowerCase();
  return normalized ? normalized : undefined;
};

export const validateCaptureUri = (value: string): URL | CaptureResult => {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return { status: 'invalid', issues: [issue('invalid_uri', 'The source URI is malformed.')] };
  }
  if (uri.protocol !== 'http:' && uri.protocol !== 'https:') {
    return {
      status: 'invalid',
      issues: [issue('unsupported_scheme', 'Only http and https source URIs are supported.')],
    };
  }
  if (isBlockedHost(uri.hostname)) {
    return {
      status: 'invalid',
      issues: [issue('blocked_host', 'Loopback, private, and link-local hosts are not supported.')],
    };
  }
  return uri;
};

export class HttpSourceCaptureAdapter implements SourceCaptureAdapter {
  public constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly resolveAddresses: HostAddressResolver = resolveHostAddresses,
  ) {}

  private async validateResolvedDestination(uri: URL): Promise<CaptureResult | undefined> {
    if (this.resolveAddresses === undefined) return undefined;
    try {
      const addresses = await this.resolveAddresses(uri.hostname);
      if (!addresses.length) {
        return {
          status: 'failed',
          issues: [issue('network_error', `Unable to resolve '${uri.hostname}'.`)],
        };
      }
      const blocked = addresses.find((address) => isBlockedIp(address));
      if (blocked) {
        return {
          status: 'invalid',
          issues: [
            issue(
              'blocked_host',
              `Loopback, private, and link-local hosts are not supported (${blocked}).`,
            ),
          ],
        };
      }
      return undefined;
    } catch (error) {
      return {
        status: 'failed',
        issues: [issue('network_error', `Unable to resolve '${uri.hostname}': ${String(error)}`)],
      };
    }
  }

  public async capture(request: CaptureRequest): Promise<CaptureResult> {
    const parsed = validateCaptureUri(request.uri);
    if (!(parsed instanceof URL)) return parsed;
    const maxBytes = request.max_bytes ?? DEFAULT_MAX_BYTES;
    const timeoutMs = request.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const maxRedirects = request.max_redirects ?? DEFAULT_MAX_REDIRECTS;
    if (!Number.isInteger(maxBytes) || maxBytes < 1) {
      return {
        status: 'invalid',
        issues: [issue('invalid_size_limit', 'max_bytes must be a positive integer.')],
      };
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      return {
        status: 'invalid',
        issues: [issue('invalid_timeout', 'timeout_ms must be a positive integer.')],
      };
    }
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
      return {
        status: 'invalid',
        issues: [issue('invalid_redirect_limit', 'max_redirects must be a non-negative integer.')],
      };
    }
    const timeout = new AbortController();
    const abortFromCaller = () => timeout.abort();
    if (request.signal?.aborted) timeout.abort();
    request.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    try {
      if (timeout.signal.aborted) {
        return {
          status: 'failed',
          issues: [issue('aborted', 'The capture timed out or was aborted.')],
        };
      }
      let current = parsed;
      const resolvedDestination = await this.validateResolvedDestination(current);
      if (resolvedDestination) return resolvedDestination;
      let response: Response | undefined;
      const redirectChain: RedirectHop[] = [];
      for (let redirects = 0; ; redirects += 1) {
        try {
          response = await this.fetcher(current, { redirect: 'manual', signal: timeout.signal });
        } catch (error) {
          const aborted = timeout.signal.aborted || request.signal?.aborted;
          return {
            status: 'failed',
            issues: [
              issue(
                aborted ? 'aborted' : 'network_error',
                aborted ? 'The capture timed out or was aborted.' : String(error),
              ),
            ],
          };
        }
        if (!REDIRECT_STATUSES.has(response.status)) break;
        if (redirects >= maxRedirects) {
          return {
            status: 'failed',
            issues: [issue('redirect_limit_exceeded', 'The response exceeded the redirect limit.')],
          };
        }
        const location = response.headers.get('location');
        if (!location) {
          return {
            status: 'failed',
            issues: [
              issue('invalid_redirect', 'A redirect response did not include a Location header.'),
            ],
          };
        }
        let redirectUri: string;
        try {
          redirectUri = new URL(location, current).toString();
        } catch {
          return {
            status: 'invalid',
            issues: [issue('invalid_redirect', 'The redirect Location is malformed.')],
          };
        }
        const destination = validateCaptureUri(redirectUri);
        if (!(destination instanceof URL)) return destination;
        const destinationResolution = await this.validateResolvedDestination(destination);
        if (destinationResolution) return destinationResolution;
        redirectChain.push({
          requested_uri: current.toString(),
          response_status: response.status,
          location,
          destination_uri: destination.toString(),
          metadata: normalizeResponseHeaders(response.headers),
        });
        current = destination;
      }
      if (!response) {
        return {
          status: 'failed',
          issues: [issue('network_error', 'The source response was unavailable.')],
        };
      }
      const reader = response.body?.getReader();
      if (!reader) {
        return {
          status: 'failed',
          issues: [issue('missing_body', 'The response did not provide a readable body.')],
        };
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return {
            status: 'failed',
            issues: [
              issue('response_too_large', `The response exceeds the ${maxBytes}-byte limit.`),
            ],
          };
        }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const metadata = normalizeResponseHeaders(response.headers);
      const mediaType = mediaTypeFrom(metadata);
      const content = new TextDecoder().decode(bytes);
      return {
        status: response.ok ? 'success' : 'failed',
        source: {
          requested_uri: request.uri,
          final_uri: response.url || current.toString(),
          ...(mediaType ? { media_type: mediaType } : {}),
          retrieved_at: request.retrieved_at ?? this.clock(),
          response_status: response.status,
          ...(redirectChain.length ? { redirect_chain: redirectChain } : {}),
          body: {
            bytes,
            ...(mediaType?.includes('html') || mediaType?.startsWith('text/')
              ? { text: content }
              : {}),
          },
          content_hash: `${HASH_ALGORITHM}:${createHash(HASH_ALGORITHM).update(bytes).digest('hex')}`,
          metadata,
        },
        issues: response.ok
          ? []
          : [issue('http_status', `The source returned HTTP status ${response.status}.`)],
      };
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
