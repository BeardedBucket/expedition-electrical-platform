import { createHash } from 'node:crypto';
import {
  prepareProductionIngestReview,
  type ManufacturerAcquisitionProfile,
  type ProductIntake,
  type SourceCaptureAdapter,
} from '@expedition/ingestion';
import { IngestionJobService, FileIngestionJobStore } from '@expedition/ingestion-runtime';
import { operatorPolicy } from '../server/runtime.js';

export const input = {
  manufacturer: 'Example Manufacturer',
  product_model: 'Example Model',
  manufacturer_part_number: 'EX-1',
  official_product_uri: 'https://example.test/products/ex-1',
};
export const intake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'intake.test',
  ...input,
};
export const profile: ManufacturerAcquisitionProfile = {
  schema_version: '1.2',
  id: 'example.admin.reviewed',
  profile_status: 'reviewed',
  manufacturer: input.manufacturer,
  publisher: input.manufacturer,
  official_domains: ['example.test'],
  allowed_document_domains: ['example.test'],
  strategies: [
    {
      id: 'product-pages',
      status: 'reviewed',
      reference_uri: input.official_product_uri,
      path_prefix: '/products/',
      embedded_json: {
        representation: 'embedded_json',
        script: { id: 'absent', media_type: 'application/json' },
        json_path: '$.product',
        record_collection_path: '$.documents',
        identity_property: 'sku',
      },
      document_link_discovery: {
        link_attribute: 'href',
        allowed_extensions: ['.html'],
        path_prefix: '/docs/',
        role_hints: [{ pattern: 'specifications', role: 'specification_sheet' }],
      },
    },
  ],
  provenance: {
    source_artifact: 'synthetic admin test fixture',
    observed_source_content_hash: `sha256:${'a'.repeat(64)}`,
  },
};
export function fixtureAdapter(withCandidate = true): SourceCaptureAdapter {
  return {
    async capture(request) {
      const html = request.uri.includes('/docs/')
        ? '<html><body><h1>Specifications</h1><table><thead><tr><th>Model</th><th>nominal voltage</th><th>continuous current</th></tr></thead><tbody><tr><td>EX-1</td><td>24 V</td><td>10 A</td></tr></tbody></table><table><thead><tr><th>Model</th><th>nominal voltage</th><th>continuous current</th></tr></thead><tbody><tr><td>EX-1</td><td>24.0 V</td><td>10.0 A</td></tr></tbody></table></body></html>'
        : `<html><body><h1>Example Model</h1><p>Official product information for EX-1. RAW_BODY_MARKER</p>${withCandidate ? '<a href="https://example.test/docs/specifications.html">Specifications</a>' : ''}</body></html>`;
      const bytes = new TextEncoder().encode(html);
      return {
        status: 'success',
        issues: [],
        source: {
          requested_uri: request.uri,
          final_uri: request.uri,
          retrieved_at: '2026-09-08T00:00:00.000Z',
          media_type: 'text/html',
          response_status: 200,
          body: { text: html, bytes },
          content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        },
      };
    },
  };
}
export function fixtureService(root: string, withCandidate = true) {
  return new IngestionJobService({
    store: new FileIngestionJobStore(root),
    preparationRequest: () => ({
      adapter: fixtureAdapter(withCandidate),
      profile,
      policy: operatorPolicy,
    }),
  });
}
export async function fixturePreparation(withCandidate = true) {
  return prepareProductionIngestReview({
    intake,
    adapter: fixtureAdapter(withCandidate),
    profile,
    policy: operatorPolicy,
  });
}
