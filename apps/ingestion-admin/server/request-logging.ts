export interface RequestContext {
  readonly request_id: string;
  readonly method: string;
  readonly pathname: string;
  readonly job_id?: string;
  readonly operation?: 'create' | 'prepare' | 'get' | 'list';
}

interface ErrorDiagnostic {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: ErrorDiagnostic;
}

// Inspect only standard Error fields. Never serialize arbitrary thrown objects,
// custom properties, jobs, request bodies, or captured evidence.
export function errorDiagnostic(
  error: unknown,
  depth = 0,
  seen = new Set<Error>(),
): ErrorDiagnostic {
  if (depth > 4) return { name: 'CauseLimit', message: 'Further causes omitted.' };
  if (!(error instanceof Error)) {
    return {
      name: 'NonErrorThrow',
      message:
        typeof error === 'string' ? error.slice(0, 2000) : `Thrown ${typeof error}; value omitted.`,
    };
  }
  if (seen.has(error)) return { name: 'CauseCycle', message: 'Circular error cause omitted.' };
  seen.add(error);
  return {
    name: depth === 0 ? error.name : error.name.slice(0, 2000),
    message: depth === 0 ? error.message : error.message.slice(0, 2000),
    stack: depth === 0 ? error.stack : error.stack?.slice(0, 8000),
    ...(error.cause === undefined ? {} : { cause: errorDiagnostic(error.cause, depth + 1, seen) }),
  };
}

export function requestContext(
  requestId: string,
  method: string,
  pathname: string,
): RequestContext {
  const match = /^\/api\/ingestion\/jobs\/([^/]+)(\/prepare)?$/.exec(pathname);
  return {
    request_id: requestId,
    method,
    pathname,
    job_id: match?.[1],
    operation:
      pathname === '/api/ingestion/jobs'
        ? method === 'POST'
          ? 'create'
          : method === 'GET'
            ? 'list'
            : undefined
        : match?.[2] && method === 'POST'
          ? 'prepare'
          : match && !match[2] && method === 'GET'
            ? 'get'
            : undefined,
  };
}

export function logRequest(
  event:
    | 'PREPARE REQUEST START'
    | 'PREPARE REQUEST COMPLETE'
    | 'PREPARE REQUEST FAILED'
    | 'REQUEST FAILED',
  context: RequestContext,
  details: {
    readonly elapsed_ms?: number;
    readonly state?: string;
    readonly status?: number;
    readonly error?: ErrorDiagnostic;
  } = {},
) {
  // JSON keeps the bounded cause chain visible instead of console inspection
  // abbreviating nested causes as [Object]. All fields above are allowlisted.
  console.error(
    JSON.stringify({ event, timestamp: new Date().toISOString(), ...context, ...details }),
  );
}
