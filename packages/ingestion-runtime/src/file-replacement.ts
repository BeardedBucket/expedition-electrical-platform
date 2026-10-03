import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const retryableCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);
const retryDelaysMs = [25, 50, 100, 150] as const;

// Package-internal test seam; this helper is not exported from the public API.
export async function replaceJobRecord(
  temporary: string,
  destination: string,
  dependencies: {
    readonly rename?: typeof rename;
    readonly delay?: (milliseconds: number) => Promise<unknown>;
  } = {},
): Promise<void> {
  const replace = dependencies.rename ?? rename;
  const delay = dependencies.delay ?? setTimeout;
  for (let attempt = 0; ; attempt++) {
    try {
      await replace(temporary, destination);
      return;
    } catch (error) {
      if (
        attempt >= retryDelaysMs.length ||
        error === null ||
        typeof error !== 'object' ||
        !retryableCodes.has((error as NodeJS.ErrnoException).code ?? '')
      )
        throw error;
      await delay(retryDelaysMs[attempt]);
    }
  }
}
