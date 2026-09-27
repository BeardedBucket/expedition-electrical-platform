import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { IngestionJobService } from '@expedition/ingestion-runtime';
import { jobDetail, jobSummary } from './operator-views.js';

export type OperatorService = Pick<
  IngestionJobService,
  'createJob' | 'prepareJob' | 'getJob' | 'listJobs'
>;
class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const fields = [
  'manufacturer',
  'product_model',
  'manufacturer_part_number',
  'official_product_uri',
] as const;
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function intakeBody(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json')
    throw new RequestError(415, 'Send application/json.');
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new RequestError(413, 'Intake request is too large.');
    chunks.push(Buffer.from(chunk));
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Malformed JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new RequestError(400, 'Expected an intake object.');
  const record = body as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !fields.includes(key as (typeof fields)[number])) ||
    fields.some((key) => typeof record[key] !== 'string' || !(record[key] as string).trim())
  )
    throw new RequestError(400, 'Provide exactly the four non-empty product intake fields.');
  return Object.fromEntries(fields.map((key) => [key, (record[key] as string).trim()])) as Record<
    (typeof fields)[number],
    string
  >;
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

export function createOperatorApi(
  service: OperatorService,
  browserOrigin = 'http://127.0.0.1:5174',
) {
  return createServer((req, res) => {
    void (async () => {
      // Local maintainer boundary: do not accept cross-site browser mutations.
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw new RequestError(403, 'Cross-site requests are not allowed.');
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== browserOrigin
      )
        throw new RequestError(403, 'Origin must match the local admin server.');
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/api/ingestion/jobs') {
        if (req.method === 'GET')
          return send(res, 200, { jobs: (await service.listJobs()).map(jobSummary) });
        if (req.method === 'POST') {
          const input = await intakeBody(req);
          const job = await service.createJob({
            schema_version: '1.0',
            artifact_kind: 'product_intake',
            id: `intake.${randomUUID()}`,
            ...input,
          });
          return send(res, 201, jobDetail(job));
        }
        throw new RequestError(405, 'Method not allowed.');
      }
      const match = /^\/api\/ingestion\/jobs\/([^/]+)(\/prepare)?$/.exec(pathname);
      if (!match) throw new RequestError(404, 'Route not found.');
      if (!validId.test(match[1])) throw new RequestError(400, 'Malformed ingestion job ID.');
      if (match[2] && req.method === 'POST')
        return send(res, 200, jobDetail(await service.prepareJob(match[1])));
      if (!match[2] && req.method === 'GET')
        return send(res, 200, jobDetail(await service.getJob(match[1])));
      throw new RequestError(405, 'Method not allowed.');
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      const status =
        error instanceof RequestError
          ? error.status
          : message.startsWith('Invalid product intake:')
            ? 400
            : message.startsWith('Unknown ingestion job ID:')
              ? 404
              : message.startsWith('Cannot prepare job in state ') ||
                  message.includes('already has an operation in progress.')
                ? 409
                : 500;
      send(res, status, {
        error: {
          message:
            status === 500 ? 'The ingestion service could not complete the request.' : message,
        },
      });
    });
  });
}
