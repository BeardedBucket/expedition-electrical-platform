import { createHash } from 'node:crypto';
import type {
  ProductIntake,
  SourceCaptureAdapter,
  ManufacturerAcquisitionProfile,
} from '../../src/index.js';

export const resolutionUri = 'https://example.test/products/ex-1';
export const resolutionIntake: ProductIntake = {
  schema_version: '1.0',
  artifact_kind: 'product_intake',
  id: 'intake.resolution',
  manufacturer: 'Example Manufacturer',
  product_model: 'Example Model',
  manufacturer_part_number: 'EX-1',
};
export const resolutionProfile: ManufacturerAcquisitionProfile = {
  schema_version: '1.2',
  id: 'example.resolution',
  profile_status: 'reviewed',
  manufacturer: resolutionIntake.manufacturer,
  publisher: 'Example Publications',
  official_domains: ['example.test'],
  strategies: [
    {
      id: 'products',
      status: 'reviewed',
      path_prefix: '/products/',
      embedded_json: {
        representation: 'embedded_json',
        script: { id: 'absent', media_type: 'application/json' },
        json_path: '$.product',
        record_collection_path: '$.records',
        identity_property: 'sku',
      },
      document_link_discovery: {
        link_attribute: 'href',
        allowed_extensions: ['.html'],
        path_prefix: '/docs/',
      },
    },
  ],
  provenance: {
    source_artifact: 'synthetic fixture',
    observed_source_content_hash: `sha256:${'a'.repeat(64)}`,
  },
};
export function resolutionAdapter(
  options: { html?: string; final_uri?: string; failed?: boolean } = {},
): SourceCaptureAdapter {
  return {
    async capture(request) {
      if (options.failed)
        return {
          status: 'failed',
          issues: [{ code: 'network_error', message: 'Offline fixture failed.' }],
          ...(options.final_uri
            ? {
                source: {
                  requested_uri: request.uri,
                  final_uri: options.final_uri,
                  retrieved_at: '2026-09-08T00:00:00.000Z',
                  response_status: 403,
                  media_type: 'text/html',
                  body: { bytes: new Uint8Array(), text: '' },
                },
              }
            : {}),
        };
      const html =
        options.html ??
        '<html><head><title>Example product</title></head><body><h1>Example Model</h1><p>Example Manufacturer EX-1 RAW_BODY_MARKER</p><table><tr><th>Model</th><th>nominal voltage</th></tr><tr><td>EX-1</td><td>24 V</td></tr></table><table><tr><th>Model</th><th>nominal voltage</th></tr><tr><td>EX-1</td><td>24.0 V</td></tr></table></body></html>';
      const bytes = new TextEncoder().encode(html);
      return {
        status: 'success',
        issues: [],
        source: {
          requested_uri: request.uri,
          final_uri: options.final_uri ?? request.uri,
          retrieved_at: '2026-09-08T00:00:00.000Z',
          response_status: 200,
          media_type: 'text/html',
          body: { bytes, text: html },
          content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        },
      };
    },
  };
}
