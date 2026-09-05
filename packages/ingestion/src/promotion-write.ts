import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { JsonObject } from './contracts.js';
import {
  canonicalIdentityCollision,
  canonicalProposalSchemaIssues,
  canonicalProposalSchemaValid,
  type PromotionIssue,
  type PromotionResult,
} from './promotion.js';

export type CanonicalWriteStatus = 'written' | 'dry_run' | 'blocked' | 'invalid';

export type CanonicalWriteIssueCode =
  | 'write_not_authorized'
  | 'write_path_invalid'
  | 'write_target_missing'
  | 'promotion_already_exists'
  | 'promotion_invalid_component'
  | 'write_failed';

export interface CanonicalWriteRequest {
  readonly promotion: PromotionResult;
  readonly destinationRoot: string;
  readonly filename?: string;
  readonly write?: boolean;
  readonly overwrite?: boolean;
  readonly catalogComponents?: readonly JsonObject[];
}

export interface CanonicalWriteResult {
  readonly status: CanonicalWriteStatus;
  readonly issues: readonly PromotionIssue[];
  readonly path?: string;
  readonly proposal?: JsonObject;
  readonly audit?: PromotionResult['audit'];
  readonly serialized?: string;
  readonly schema_valid: boolean;
  readonly collision: boolean;
}

const writeIssue = (
  code: CanonicalWriteIssueCode,
  path: string,
  message: string,
): PromotionIssue => ({ code: code as PromotionIssue['code'], path, message });

const expectedFilenameFor = (proposal: JsonObject): string => `${String(proposal.id)}.yaml`;

const safeCanonicalPath = (
  destinationRoot: string,
  filename: string,
): { path?: string; issue?: PromotionIssue } => {
  if (
    !filename ||
    isAbsolute(filename) ||
    win32.isAbsolute(filename) ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename === '.' ||
    filename === '..'
  )
    return {
      issue: writeIssue(
        'write_path_invalid',
        'filename',
        'Canonical filename must be a single safe filename.',
      ),
    };
  const root = resolve(destinationRoot);
  const target = resolve(root, filename);
  const withinRoot = relative(root, target);
  if (!withinRoot || withinRoot.startsWith('..') || isAbsolute(withinRoot))
    return {
      issue: writeIssue(
        'write_path_invalid',
        'filename',
        'Canonical destination must remain inside data/components.',
      ),
    };
  return { path: target };
};

const proposalFrom = (promotion: PromotionResult): JsonObject | undefined =>
  promotion.status === 'success' ? promotion.proposal : undefined;

export const serializeCanonicalComponent = (proposal: JsonObject): string =>
  stringifyYaml(proposal, { sortMapEntries: true });

export const writeCanonicalComponent = async (
  request: CanonicalWriteRequest,
): Promise<CanonicalWriteResult> => {
  const proposal = proposalFrom(request.promotion);
  if (!proposal)
    return {
      status: request.promotion.status === 'invalid' ? 'invalid' : 'blocked',
      issues: request.promotion.issues,
      schema_valid: false,
      collision: false,
    };

  const filename = request.filename ?? expectedFilenameFor(proposal);
  if (filename !== expectedFilenameFor(proposal))
    return {
      status: 'blocked',
      issues: [
        writeIssue(
          'write_path_invalid',
          'filename',
          `Canonical filename must be '${expectedFilenameFor(proposal)}'.`,
        ),
      ],
      proposal,
      audit: request.promotion.audit,
      schema_valid: false,
      collision: false,
    };
  const safePath = safeCanonicalPath(request.destinationRoot, filename);
  if (safePath.issue)
    return {
      status: 'blocked',
      issues: [safePath.issue],
      proposal,
      audit: request.promotion.audit,
      schema_valid: false,
      collision: false,
    };
  const targetPath = safePath.path;
  if (!targetPath) throw new Error('Canonical path resolution did not produce a destination path.');

  const collision = canonicalIdentityCollision(proposal, request.catalogComponents ?? []);
  const issues: PromotionIssue[] = collision
    ? [
        writeIssue(
          'promotion_already_exists',
          'catalogComponents',
          `A canonical component already exists for '${String(proposal.id)}'.`,
        ),
      ]
    : [];
  if (collision)
    return {
      status: 'blocked',
      issues,
      path: safePath.path,
      proposal,
      audit: request.promotion.audit,
      schema_valid: false,
      collision,
    };

  try {
    await access(targetPath);
    return {
      status: 'blocked',
      issues: [
        writeIssue(
          'promotion_already_exists',
          'path',
          `Canonical file already exists at '${safePath.path}'.`,
        ),
      ],
      path: targetPath,
      proposal,
      audit: request.promotion.audit,
      schema_valid: false,
      collision: true,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const schemaIssues = canonicalProposalSchemaIssues(proposal);
  if (schemaIssues.length > 0)
    return {
      status: 'invalid',
      issues: schemaIssues,
      path: targetPath,
      proposal,
      audit: request.promotion.audit,
      schema_valid: false,
      collision: false,
    };

  const serialized = serializeCanonicalComponent(proposal);
  if (!request.write)
    return {
      status: 'dry_run',
      issues: [
        writeIssue(
          'write_not_authorized',
          'write',
          'Canonical write requires explicit write authorization.',
        ),
      ],
      path: targetPath,
      proposal,
      audit: request.promotion.audit,
      serialized,
      schema_valid: canonicalProposalSchemaValid(proposal),
      collision: false,
    };
  if (request.overwrite === true)
    return {
      status: 'blocked',
      issues: [
        writeIssue(
          'write_not_authorized',
          'overwrite',
          'Canonical promotion does not support overwrite.',
        ),
      ],
      path: targetPath,
      proposal,
      audit: request.promotion.audit,
      serialized,
      schema_valid: true,
      collision: false,
    };

  try {
    await writeFile(targetPath, serialized, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST')
      return {
        status: 'blocked',
        issues: [
          writeIssue(
            'promotion_already_exists',
            'path',
            `Canonical file already exists at '${safePath.path}'.`,
          ),
        ],
        path: targetPath,
        proposal,
        audit: request.promotion.audit,
        serialized,
        schema_valid: true,
        collision: true,
      };
    return {
      status: 'blocked',
      issues: [
        writeIssue(
          'write_failed',
          'path',
          `Unable to create canonical component: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
      path: targetPath,
      proposal,
      audit: request.promotion.audit,
      serialized,
      schema_valid: true,
      collision: false,
    };
  }
  return {
    status: 'written',
    issues: [],
    path: targetPath,
    proposal,
    audit: request.promotion.audit,
    serialized,
    schema_valid: true,
    collision: false,
  };
};

export const loadCanonicalCatalog = async (destinationRoot: string): Promise<JsonObject[]> => {
  const entries = await readdir(destinationRoot, { withFileTypes: true });
  const components: JsonObject[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(json|ya?ml)$/i.test(entry.name)) continue;
    const file = join(destinationRoot, entry.name);
    const text = await readFile(file, 'utf8');
    const parsed = /\.(ya?ml)$/i.test(entry.name) ? parseYaml(text) : JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) components.push(parsed);
  }
  return components;
};
