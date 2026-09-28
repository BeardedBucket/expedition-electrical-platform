// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { replaceJobRecord } from '../src/file-replacement.js';

const filesystemError = (code?: string) =>
  Object.assign(
    new Error(`Replacement failure: ${code ?? 'unknown'}`),
    code === undefined ? {} : { code },
  );

describe('bounded atomic record replacement', () => {
  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'retries transient %s using the same paths and succeeds',
    async (code) => {
      const rename = vi
        .fn()
        .mockRejectedValueOnce(filesystemError(code))
        .mockResolvedValueOnce(undefined);
      const delay = vi.fn().mockResolvedValue(undefined);
      await replaceJobRecord('temporary', 'destination', { rename, delay });
      expect(rename.mock.calls).toEqual([
        ['temporary', 'destination'],
        ['temporary', 'destination'],
      ]);
      expect(delay.mock.calls).toEqual([[25]]);
    },
  );

  it.each(['ENOENT', 'ENOSPC', undefined])(
    'immediately propagates a non-retryable %s error',
    async (code) => {
      const error = filesystemError(code);
      const rename = vi.fn().mockRejectedValue(error);
      const delay = vi.fn();
      await expect(replaceJobRecord('temporary', 'destination', { rename, delay })).rejects.toBe(
        error,
      );
      expect(rename).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    },
  );

  it('stops after five attempts and rethrows the final transient error', async () => {
    const errors = Array.from({ length: 5 }, (_, index) =>
      Object.assign(filesystemError('EPERM'), { attempt: index }),
    );
    const rename = vi.fn(async () => {
      throw errors[rename.mock.calls.length - 1];
    });
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(replaceJobRecord('temporary', 'destination', { rename, delay })).rejects.toBe(
      errors[4],
    );
    expect(rename).toHaveBeenCalledTimes(5);
    expect(delay.mock.calls).toEqual([[25], [50], [100], [150]]);
  });

  it('stops when a later attempt encounters a non-retryable error', async () => {
    const error = filesystemError('ENOSPC');
    const rename = vi
      .fn()
      .mockRejectedValueOnce(filesystemError('EBUSY'))
      .mockRejectedValueOnce(error);
    const delay = vi.fn().mockResolvedValue(undefined);
    await expect(replaceJobRecord('temporary', 'destination', { rename, delay })).rejects.toBe(
      error,
    );
    expect(rename).toHaveBeenCalledTimes(2);
    expect(delay.mock.calls).toEqual([[25]]);
  });
});
