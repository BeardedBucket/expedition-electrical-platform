// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ComponentLibraryRecord } from '@expedition/engineering-core';
import { buildIntakeSuggestions, loadIntakeSuggestions } from '../server/suggestions.js';
import { operatorConfiguration } from '../server/runtime.js';

describe('authoritative intake suggestions', () => {
  it('loads reviewed manufacturer spellings using validated project data', async () => {
    const suggestions = await loadIntakeSuggestions(
      operatorConfiguration({ INGESTION_REPOSITORY_ROOT: process.cwd() }),
    );
    expect(suggestions.manufacturers).toContain('Victron Energy');
    expect(suggestions.manufacturers).not.toContain('Victron');
    expect(
      suggestions.products.every((product) => product.provenance.startsWith('verified component:')),
    ).toBe(true);
    expect(suggestions.products.some((product) => product.provenance.includes('ekrano'))).toBe(
      false,
    );
  });
  it('excludes unverified/partially verified product identities and preserves canonical spelling', () => {
    const record: ComponentLibraryRecord = {
      id: 'example.a',
      manufacturer: 'Canonical Maker',
      model: 'Model A',
      part_number: 'SKU-A',
      category: 'test',
      verification_status: 'verified',
    };
    const suggestions = buildIntakeSuggestions(
      [
        record,
        { ...record, manufacturer: 'Unreviewed typo', verification_status: 'unverified' },
        { ...record, manufacturer: 'Partial', verification_status: 'partially_verified' },
      ],
      [],
    );
    expect(suggestions).toEqual({
      manufacturers: ['Canonical Maker'],
      products: [
        {
          manufacturer: 'Canonical Maker',
          model: 'Model A',
          mpn: 'SKU-A',
          provenance: 'verified component: example.a',
        },
      ],
    });
  });
});
