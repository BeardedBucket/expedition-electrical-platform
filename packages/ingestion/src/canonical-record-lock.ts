import { open, rm } from 'node:fs/promises';

/** Shared by verification and real-filesystem amendments. Fail on contention;
 * there is no retry budget, timeout or automatic theft of a crashed writer's
 * lock. A local operator must inspect an abandoned lock before removing it.
 * Cleanup errors propagate even if replacement already succeeded: callers must
 * reload the canonical snapshot before any new intent, never blindly retry. */
export const withCanonicalRecordLock = async <T>(
  path: string,
  work: () => Promise<T>,
): Promise<T> => {
  const lockPath = `${path}.authority.lock`;
  const handle = await open(lockPath, 'wx');
  try {
    return await work();
  } finally {
    try {
      await handle.close();
    } finally {
      await rm(lockPath);
    }
  }
};
