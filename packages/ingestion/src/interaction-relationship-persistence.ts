// Filesystem persistence for canonical interaction relationships: atomic
// temp-file write, rename, backup, and rollback mechanics.
//
// This module owns filesystem behavior only. It composes the promotion
// module's proposal decision; it must not perform semantic/structural
// validation itself.

import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  canonicalInteractionRelationshipIssue,
  type CanonicalInteractionRelationshipIssue,
  type CanonicalInteractionRelationshipRequest,
  type CanonicalInteractionRelationshipResult,
  type InteractionRelationship,
} from './interaction-relationship-types.js';
import {
  canonicalInteractionRelationshipSnapshot,
  proposeCanonicalInteractionRelationship,
} from './interaction-relationship-promotion.js';

const safeInteractionRelationshipPath = (
  destinationRoot: string,
  filename: string,
): { path?: string; issue?: CanonicalInteractionRelationshipIssue } => {
  if (
    !filename ||
    !filename.endsWith('.yaml') ||
    isAbsolute(filename) ||
    win32.isAbsolute(filename) ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename === '.' ||
    filename === '..'
  ) {
    return {
      issue: canonicalInteractionRelationshipIssue(
        'write_path_invalid',
        'filename',
        'Interaction relationship filename must be a single .yaml filename.',
      ),
    };
  }
  const root = resolve(destinationRoot);
  const target = resolve(root, filename);
  const withinRoot = relative(root, target);
  if (!withinRoot || withinRoot.startsWith('..') || isAbsolute(withinRoot)) {
    return {
      issue: canonicalInteractionRelationshipIssue(
        'write_path_invalid',
        'filename',
        'Canonical relationship destination must remain inside the declared root directory.',
      ),
    };
  }
  return { path: target };
};

export const writeCanonicalInteractionRelationship = async (
  request: CanonicalInteractionRelationshipRequest,
): Promise<CanonicalInteractionRelationshipResult> => {
  const proposalResult = proposeCanonicalInteractionRelationship(request);
  if (proposalResult.status !== 'proposed') return proposalResult;
  const destinationRoot = request.destinationRoot ?? process.cwd();
  const relationshipId = String(
    request.review.relationship_id ?? proposalResult.proposal?.id ?? '',
  );
  const targetFilename = request.filename ?? `${relationshipId}.yaml`;
  const safePath = safeInteractionRelationshipPath(destinationRoot, targetFilename);
  if (safePath.issue || !safePath.path) {
    return {
      ...proposalResult,
      status: 'blocked',
      issues: safePath.issue ? [safePath.issue] : [],
    };
  }
  const targetPath = safePath.path;
  const filesystem = request.filesystem ?? {
    access,
    readFile: async (path: string, encoding: 'utf8') => readFile(path, encoding),
    mkdir,
    writeFile,
    rename,
    rm,
  };
  if (!request.write) {
    return {
      ...proposalResult,
      status: 'dry_run',
      path: targetPath,
      serialized: proposalResult.serialized,
      issues: [
        canonicalInteractionRelationshipIssue(
          'write_not_authorized',
          'write',
          'Explicit write authorization is required to persist canonical relationship data.',
        ),
      ],
    };
  }

  try {
    await filesystem.access(targetPath);
    const raw = await filesystem.readFile(targetPath, 'utf8');
    const parsed = parseYaml(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Canonical relationship target is not an object.');
    }
    const diskCurrent = parsed as InteractionRelationship;
    const expected = request.review.expected_snapshot ?? request.review.expected_current_snapshot;
    const diskSnapshot = canonicalInteractionRelationshipSnapshot(diskCurrent);
    if (diskCurrent.id !== relationshipId) {
      return {
        ...proposalResult,
        status: 'blocked',
        issues: [
          canonicalInteractionRelationshipIssue(
            'relationship_already_exists',
            'path',
            'On-disk canonical relationship ID does not match the review target.',
          ),
        ],
      };
    }
    if (
      diskSnapshot !== expected ||
      canonicalInteractionRelationshipSnapshot(request.current) !== diskSnapshot
    ) {
      return {
        ...proposalResult,
        status: 'blocked',
        actual_snapshot: diskSnapshot,
        issues: [
          canonicalInteractionRelationshipIssue(
            'canonical_snapshot_mismatch',
            'expected_snapshot',
            'The on-disk canonical relationship snapshot is stale relative to the reviewed and supplied records.',
          ),
        ],
      };
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // New relationship; continue with atomic write.
    } else {
      return {
        ...proposalResult,
        status: 'blocked',
        issues: [
          canonicalInteractionRelationshipIssue(
            'write_target_missing',
            'path',
            `Unable to read canonical relationship target: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ],
      };
    }
  }

  const serialized = stringifyYaml(proposalResult.proposal, { sortMapEntries: true });
  const tempPath = join(dirname(targetPath), `.${targetFilename}.${process.pid}.${Date.now()}.tmp`);
  const backupPath = `${targetPath}.${process.pid}.${Date.now()}.bak`;
  let backupCreated = false;
  let replacementCompleted = false;
  const removeTempSafely = async (): Promise<void> => {
    try {
      await filesystem.rm(tempPath, { force: true });
    } catch {
      // A failed temporary cleanup must not obscure the canonical recovery state.
    }
  };
  try {
    await filesystem.mkdir(dirname(targetPath), { recursive: true });
    await filesystem.writeFile(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
    try {
      await filesystem.access(targetPath);
      await filesystem.rename(targetPath, backupPath);
      backupCreated = true;
    } catch {
      // Create a new file if we are writing a canonical relationship for the first time.
    }
    try {
      await filesystem.rename(tempPath, targetPath);
      replacementCompleted = true;
      await filesystem.access(targetPath);
      if (backupCreated) await filesystem.rm(backupPath, { force: true });
    } catch (error) {
      if (backupCreated && !replacementCompleted) {
        try {
          await filesystem.rename(backupPath, targetPath);
          await removeTempSafely();
          return {
            ...proposalResult,
            status: 'blocked',
            issues: [
              canonicalInteractionRelationshipIssue(
                'write_failed',
                'path',
                `Canonical relationship replacement failed; rollback restored the original target: ${error instanceof Error ? error.message : String(error)}`,
              ),
            ],
          };
        } catch (rollbackError) {
          await removeTempSafely();
          return {
            ...proposalResult,
            status: 'blocked',
            issues: [
              canonicalInteractionRelationshipIssue(
                'write_failed',
                'path',
                `Canonical relationship replacement failed and rollback also failed. Backup preserved at '${backupPath}' for recovery. Replacement error: ${error instanceof Error ? error.message : String(error)}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
              ),
            ],
          };
        }
      }
      throw error;
    }
  } catch (error) {
    await removeTempSafely();
    return {
      ...proposalResult,
      status: 'blocked',
      issues: [
        canonicalInteractionRelationshipIssue(
          'write_failed',
          'path',
          `Unable to atomically replace canonical relationship: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }

  return {
    ...proposalResult,
    status: 'written',
    path: targetPath,
    serialized,
    issues: [],
  };
};

export const applyCanonicalInteractionRelationship = writeCanonicalInteractionRelationship;
