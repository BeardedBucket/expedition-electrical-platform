import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

const response = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('batch API client', () => {
  it('posts the ordinary intake fields to the existing batch endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ summary: {}, job_ids: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const entries = [
      {
        manufacturer: 'Maker',
        product_model: 'Model',
        manufacturer_part_number: 'M-1',
        official_product_uri: '',
      },
      {
        manufacturer: 'Maker',
        product_model: 'Model 2',
        manufacturer_part_number: '',
        official_product_uri: 'https://example.test/model-2',
      },
    ];
    await api.createBatch(entries);
    expect(fetchMock).toHaveBeenCalledWith('/api/ingestion/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { manufacturer: 'Maker', product_model: 'Model', manufacturer_part_number: 'M-1' },
        {
          manufacturer: 'Maker',
          product_model: 'Model 2',
          official_product_uri: 'https://example.test/model-2',
        },
      ]),
    });
  });

  it('uses the existing list, detail, and prepare endpoints and surfaces HTTP errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ batches: [] }))
      .mockResolvedValueOnce(response({ summary: {}, job_ids: [] }))
      .mockResolvedValueOnce(response({ summary: {}, job_ids: [] }))
      .mockResolvedValueOnce(
        response({ error: { message: 'Unknown ingestion batch ID' } }, false, 404),
      );
    vi.stubGlobal('fetch', fetchMock);

    await api.listBatches();
    await api.getBatch('batch/id');
    await api.prepareBatch('batch/id');
    await expect(api.getBatch('missing')).rejects.toThrow('Unknown ingestion batch ID');
    expect(fetchMock.mock.calls.map(([url, options]) => [url, options?.method ?? 'GET'])).toEqual([
      ['/api/ingestion/batches', 'GET'],
      ['/api/ingestion/batches/batch%2Fid', 'GET'],
      ['/api/ingestion/batches/batch%2Fid/prepare', 'POST'],
      ['/api/ingestion/batches/missing', 'GET'],
    ]);
  });
});
