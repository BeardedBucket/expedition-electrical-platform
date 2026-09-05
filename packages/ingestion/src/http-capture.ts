import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { CaptureRequest, CaptureResult, SourceCaptureAdapter } from './capture-types.js';

export const DEFAULT_MAX_BYTES = 2_000_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_REDIRECTS = 5;

const issue = (code: string, message: string) => ({ code, message });

const isBlockedHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  const version = isIP(normalized);
  if (version === 4) {
    const octets = normalized.split('.').map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }
  return (
    version === 6 &&
    (normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb'))
  );
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
  ) {}

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
      let response: Response;
      for (let redirects = 0; ; redirects += 1) {
        try {
          response = await this.fetcher(current, { redirect: 'manual', signal: timeout.signal });
        } catch (error) {
          const aborted = timeout.signal.aborted || request.signal?.aborted;
          return {
            status: 'failed',
            issues: [
              issue(
                aborted ? 'aborted' : 'fetch_failed',
                aborted ? 'The capture timed out or was aborted.' : String(error),
              ),
            ],
          };
        }
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
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
        current = destination;
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
      const content = new TextDecoder().decode(bytes);
      const mediaType =
        response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ||
        'application/octet-stream';
      return {
        status: response.ok ? 'success' : 'failed',
        source: {
          requested_uri: request.uri,
          final_uri: response.url || current.toString(),
          media_type: mediaType,
          retrieved_at: request.retrieved_at ?? this.clock(),
          response_status: response.status,
          body: {
            bytes,
            ...(mediaType.includes('html') || mediaType.startsWith('text/')
              ? { text: content }
              : {}),
          },
          content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
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
