import { validateProductIntake, type ProductIntake } from '@expedition/ingestion';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  MAX_INGESTION_BATCH_SIZE,
  type IngestionBatchService,
  type IngestionJobService,
} from '@expedition/ingestion-runtime';
import { SourceResolutionError } from '@expedition/ingestion-runtime';
import type { IntakeSuggestions } from './suggestions.js';
import { batchDetail, batchSummary, jobDetail, jobSummary } from './operator-views.js';
import { errorDiagnostic, logRequest, requestContext } from './request-logging.js';
import { constructApproval, ProductReviewError } from './product-review.js';

export type OperatorService = Pick<
  IngestionJobService,
  'createJob' | 'prepareJob' | 'getJob' | 'listJobs'
> &
  Partial<
    Pick<
      IngestionJobService,
      | 'submitSourceResolutionCandidate'
      | 'decideSourceResolution'
      | 'submitApproval'
      | 'finalizeJob'
    >
  > &
  Partial<Pick<IngestionBatchService, 'createBatch' | 'getBatch' | 'listBatches' | 'prepareBatch'>>;
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

async function jsonValue(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json')
    throw new RequestError(415, 'Send application/json.');
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 16_384) throw new RequestError(413, 'Intake request is too large.');
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'Malformed JSON.');
  }
}

async function jsonBody(req: IncomingMessage) {
  const body = await jsonValue(req);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new RequestError(400, 'Expected an intake object.');
  return body as Record<string, unknown>;
}

async function intakeBody(req: IncomingMessage) {
  const record = await jsonBody(req);
  if (
    Object.keys(record).some((key) => !fields.includes(key as (typeof fields)[number])) ||
    ['manufacturer', 'product_model'].some(
      (key) => typeof record[key] !== 'string' || !(record[key] as string).trim(),
    )
  )
    throw new RequestError(
      400,
      'Provide manufacturer, product model and at least one identification-evidence field.',
    );
  const normalized = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() : value,
    ]),
  );
  const issues = validateProductIntake({ id: 'validation', ...normalized });
  if (issues.length) throw new RequestError(400, issues.join('; '));
  return normalized as Pick<ProductIntake, (typeof fields)[number]>;
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
  suggestions: () => IntakeSuggestions | Promise<IntakeSuggestions> = () => {
    throw new Error('Canonical suggestion provider is not configured.');
  },
  canonicalRoot?: string,
) {
  return createServer((req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    let context = requestContext(
      requestId,
      req.method ?? 'UNKNOWN',
      (req.url ?? '/').split('?')[0],
    );
    let prepareStarted: number | undefined;
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
      context = requestContext(requestId, req.method ?? 'UNKNOWN', pathname);
      if (pathname === '/api/ingestion/suggestions' && req.method === 'GET') {
        try {
          return send(res, 200, await suggestions());
        } catch (error) {
          logRequest('REQUEST FAILED', context, { status: 503, error: errorDiagnostic(error) });
          return send(res, 503, {
            error: { message: 'Canonical suggestions unavailable. Free entry remains available.' },
          });
        }
      }
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
      if (pathname === '/api/ingestion/batches') {
        if (!service.listBatches || !service.createBatch)
          throw new Error('Batch service is not configured.');
        if (req.method === 'GET')
          return send(res, 200, { batches: (await service.listBatches()).map(batchSummary) });
        if (req.method === 'POST') {
          const input = await jsonValue(req);
          if (!Array.isArray(input) || input.length === 0)
            throw new RequestError(400, 'Provide a non-empty array of product intakes.');
          if (input.length > MAX_INGESTION_BATCH_SIZE)
            throw new RequestError(
              400,
              `Batch size exceeds the maximum of ${MAX_INGESTION_BATCH_SIZE} products.`,
            );
          const batches = await Promise.all(
            input.map(async (item) => {
              if (!item || typeof item !== 'object' || Array.isArray(item))
                throw new RequestError(400, 'Each batch item must be an intake object.');
              const record = item as Record<string, unknown>;
              const normalized = Object.fromEntries(
                Object.entries(record).map(([key, value]) => [
                  key,
                  typeof value === 'string' ? value.trim() : value,
                ]),
              );
              const issues = validateProductIntake({ id: 'validation', ...normalized });
              if (issues.length) throw new RequestError(400, issues.join('; '));
              return {
                schema_version: '1.0',
                artifact_kind: 'product_intake',
                id: `intake.${randomUUID()}`,
                ...normalized,
              } as ProductIntake;
            }),
          );
          return send(res, 201, batchDetail(await service.createBatch(batches)));
        }
        throw new RequestError(405, 'Method not allowed.');
      }
      const jobMatch =
        /^\/api\/ingestion\/jobs\/([^/]+)(\/prepare|\/review\/(?:approve|reject|defer)|\/finalize|\/source-resolution\/(?:candidates|accept|reject))?$/.exec(
          pathname,
        );
      const batchMatch = /^\/api\/ingestion\/batches\/([^/]+)(\/prepare)?$/.exec(pathname);
      if (batchMatch) {
        if (!service.getBatch || !service.prepareBatch)
          throw new Error('Batch service is not configured.');
        if (!validId.test(batchMatch[1]))
          throw new RequestError(400, 'Malformed ingestion batch ID.');
        if (batchMatch[2] === '/prepare' && req.method === 'POST') {
          return send(res, 200, batchDetail(await service.prepareBatch(batchMatch[1])));
        }
        if (!batchMatch[2] && req.method === 'GET')
          return send(res, 200, batchDetail(await service.getBatch(batchMatch[1])));
        throw new RequestError(405, 'Method not allowed.');
      }
      if (!jobMatch) throw new RequestError(404, 'Route not found.');
      if (!validId.test(jobMatch[1])) throw new RequestError(400, 'Malformed ingestion job ID.');
      if (jobMatch[2]?.startsWith('/review/') && req.method === 'POST') {
        const input = await jsonBody(req);
        const action = jobMatch[2].split('/').at(-1);
        const decision =
          action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'deferred';
        const approval = constructApproval(await service.getJob(jobMatch[1]), decision, input);
        if (!service.submitApproval) throw new Error('Approval service is not configured.');
        return send(res, 200, jobDetail(await service.submitApproval(jobMatch[1], approval)));
      }
      if (jobMatch[2] === '/finalize' && req.method === 'POST') {
        const input = await jsonBody(req);
        if (Object.keys(input).length !== 1 || input.write !== true)
          throw new RequestError(
            400,
            'Provide only write:true to explicitly authorize the create-only canonical write.',
          );
        if (!canonicalRoot || !service.finalizeJob)
          throw new Error('Canonical finalization is not configured.');
        return send(
          res,
          200,
          jobDetail(
            await service.finalizeJob(jobMatch[1], {
              destinationRoot: canonicalRoot,
              write: true,
              overwrite: false,
            }),
          ),
        );
      }
      if (jobMatch[2]?.startsWith('/source-resolution/') && req.method === 'POST') {
        const body = await jsonBody(req);
        const action = jobMatch[2].split('/').at(-1);
        const field = action === 'candidates' ? 'official_product_uri' : 'attempt_id';
        if (
          Object.keys(body).length !== 1 ||
          typeof body[field] !== 'string' ||
          !body[field].trim()
        )
          throw new RequestError(400, `Provide only a nonempty ${field}.`);
        if (!service.submitSourceResolutionCandidate || !service.decideSourceResolution)
          throw new Error('Source resolution service is not configured.');
        const job =
          action === 'candidates'
            ? await service.submitSourceResolutionCandidate(jobMatch[1], body[field])
            : await service.decideSourceResolution(
                jobMatch[1],
                body[field],
                action === 'accept' ? 'accepted' : 'rejected',
              );
        return send(res, 200, jobDetail(job));
      }
      if (jobMatch[2] === '/prepare' && req.method === 'POST') {
        prepareStarted = performance.now();
        logRequest('PREPARE REQUEST START', context);
        const job = await service.prepareJob(jobMatch[1]);
        send(res, 200, jobDetail(job));
        logRequest('PREPARE REQUEST COMPLETE', context, {
          state: job.state,
          elapsed_ms: Math.round(performance.now() - prepareStarted),
        });
        return;
      }
      if (!jobMatch[2] && req.method === 'GET')
        return send(res, 200, jobDetail(await service.getJob(jobMatch[1])));
      throw new RequestError(405, 'Method not allowed.');
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      const status =
        error instanceof RequestError
          ? error.status
          : error instanceof SourceResolutionError || error instanceof ProductReviewError
            ? error.status
            : message.startsWith('Invalid product intake:') ||
                message.startsWith('Invalid product intake in batch:') ||
                message.startsWith('Batch input must be an array of product intakes.') ||
                message.startsWith('Batch must contain at least one product intake.') ||
                message.startsWith('Batch size exceeds the maximum of ')
              ? 400
              : message.startsWith('Unknown ingestion job ID:') ||
                  message.startsWith('Unknown ingestion batch ID:')
                ? 404
                : message.startsWith('Cannot prepare job in state ') ||
                    message.startsWith('Cannot prepare batch in state ') ||
                    message.startsWith('Cannot approve job in state ') ||
                    message.startsWith('Cannot finalize job in state ') ||
                    message === 'Production approval does not match the exact review package.' ||
                    message.includes('already has an operation in progress.')
                  ? 409
                  : 500;
      if (prepareStarted !== undefined) {
        logRequest('PREPARE REQUEST FAILED', context, {
          status,
          elapsed_ms: Math.round(performance.now() - prepareStarted),
          error: status === 500 ? errorDiagnostic(error) : { name: 'RequestError', message },
        });
      } else if (status === 500) {
        logRequest('REQUEST FAILED', context, { status, error: errorDiagnostic(error) });
      }
      send(res, status, {
        error: {
          message:
            status === 500 ? 'The ingestion service could not complete the request.' : message,
        },
      });
    });
  });
}
