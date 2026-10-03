import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classifyCapturePriority, compareCapturePriorities } from '../src/capture-priority.js';
import { acquireOfficialSources } from '../src/source-acquisition.js';
import { PRODUCTION_SCHEMA_VERSION, type ProductIntake } from '../src/production-contracts.js';
import type { CapturedSource, SourceCaptureAdapter } from '../src/capture-types.js';

const intake: ProductIntake = {
  schema_version: PRODUCTION_SCHEMA_VERSION,
  artifact_kind: 'product_intake',
  id: 'intake.priority',
  manufacturer: 'Independent Manufacturer',
  product_model: 'Device ZX',
  manufacturer_part_number: 'PN-42',
  official_product_uri: 'https://example.test/product/device-zx',
};
const priority = (path: string, overrides = {}) =>
  classifyCapturePriority(
    {
      normalized_uri: `https://example.test${path}`,
      role: 'unknown',
      parent_uri: intake.official_product_uri!,
      depth: 0,
      max_depth: 1,
      ...overrides,
    },
    intake,
  );
const html = (links: string) =>
  `<html><body>${'Product information. '.repeat(100)}${links}</body></html>`;
const anchor = (path: string, label: string) => `<a href="${path}">${label}</a>`;
const manual = (path: string) =>
  `<h2>Product manuals</h2><ul><li>${anchor(path, 'HTML5')}</li></ul>`;
const source = (uri: string, text: string, final = uri): CapturedSource => {
  const bytes = new TextEncoder().encode(text);
  return {
    requested_uri: uri,
    final_uri: final,
    retrieved_at: '2026-09-27T00:00:00.000Z',
    media_type: 'text/html',
    response_status: 200,
    body: { bytes, text },
    content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
};
const run = async (
  seed: string,
  documents: Record<string, string> = {},
  policy: {
    max_recursion_depth?: number;
    max_discovered_candidates?: number;
    max_captured_candidates?: number;
  } = {},
  redirects: Record<string, string> = {},
) => {
  const calls: string[] = [];
  const adapter: SourceCaptureAdapter = {
    async capture(request) {
      calls.push(request.uri);
      const path = new URL(request.uri).pathname;
      return {
        status: 'success',
        issues: [],
        source: source(
          request.uri,
          html(
            request.uri === intake.official_product_uri ? seed : (documents[path] ?? 'Evidence'),
          ),
          redirects[path] ? `https://example.test${redirects[path]}` : request.uri,
        ),
      };
    },
  };
  const result = await acquireOfficialSources({ intake, adapter, policy });
  return {
    result,
    calls,
    selected: result.candidates
      .filter((x) => x.capture)
      .map((x) => new URL(x.candidate.normalized_uri).pathname),
  };
};

describe('generic pre-capture technical priority', () => {
  it('promotes unknown-role specifications over support', () => {
    expect(priority('/technical-specifications.html').category).toBe('technical_specification');
    expect(
      compareCapturePriorities(priority('/technical-specifications.html'), priority('/support')),
    ).toBeLessThan(0);
  });
  it('promotes a concrete datasheet over plural navigation with unknown or support role', () => {
    for (const role of ['unknown', 'support_article'] as const)
      expect(
        compareCapturePriorities(priority('/datasheet.pdf'), priority('/datasheets', { role })),
      ).toBeLessThan(0);
  });
  it.each([
    ['/Device_ZX/technical-specifications.html', 'technical_specification'],
    ['/Device-ZX_Manual.pdf', 'manual'],
    ['/Device-ZX-installation.html', 'installation'],
    ['/DimensionDrawing-Device-ZX.pdf', 'technical_drawing'],
    ['/Cut-Out-Device-ZX.pdf', 'technical_drawing'],
    ['/Device-ZX-schematic.pdf', 'technical_drawing'],
  ])('recognizes generic wording with unknown role: %s', (path, category) => {
    expect(priority(path).category).toBe(category);
  });
  it('orders installation/manual before drawings, then certificate/firmware, then support', () => {
    const classes = [
      '/installation.html',
      '/manual.pdf',
      '/drawing.pdf',
      '/certificate.pdf',
      '/firmware.html',
      '/support',
    ];
    const tuples = classes.map((x) => priority(x));
    expect(compareCapturePriorities(tuples[0], tuples[1])).toBe(0);
    expect(compareCapturePriorities(tuples[1], tuples[2])).toBeLessThan(0);
    expect(compareCapturePriorities(tuples[2], tuples[3])).toBeLessThan(0);
    expect(compareCapturePriorities(tuples[3], tuples[4])).toBe(0);
    expect(compareCapturePriorities(tuples[4], tuples[5])).toBeLessThan(0);
  });
  it('uses complete separator-normalized identity, never family substring similarity', () => {
    for (const path of ['/Device-ZX/manual.pdf', '/Device_ZX/manual.pdf', '/PN-42/manual.pdf'])
      expect(priority(path).product_context).toBe('resource_identity');
    for (const path of [
      '/Device-ZX2/manual.pdf',
      '/OtherDevice-ZX/manual.pdf',
      '/PN-420/manual.pdf',
      '/PN.42/manual.pdf',
    ])
      expect(priority(path).product_context).toBe('not_asserted');
    expect(priority('/manual.pdf', { source_label: 'Device ZX manual' }).product_context).toBe(
      'resource_identity',
    );
  });
  it('inherits child identity only from the immediate manual parent, not a seed product page', () => {
    expect(
      priority('/technical-specifications.html', {
        depth: 1,
        parent_uri: 'https://example.test/Device_ZX/index.html',
      }).product_context,
    ).toBe('parent_identity');
    expect(priority('/manual.pdf').product_context).toBe('not_asserted');
  });
  it('gives a scoped structural index priority over its children and unrelated indexes', () => {
    const input = { manual_document_context: true, source_label: 'HTML5' };
    const relevant = priority('/Device-ZX/index.html', input);
    expect(relevant.category).toBe('manual_index');
    expect(
      compareCapturePriorities(relevant, priority('/Device-ZX/technical-specifications.html')),
    ).toBeLessThan(0);
    expect(compareCapturePriorities(relevant, priority('/Other/index.html', input))).toBeLessThan(
      0,
    );
    expect(priority('/Device-ZX/index.html', { ...input, max_depth: 0 }).category).not.toBe(
      'manual_index',
    );
  });
  it('keeps declared CAD/media resources below extractable documents without excluding them', () => {
    expect(priority('/DimensionDrawing-Device-ZX.STEP').category).toBe('generic');
    expect(priority('/Device-ZX-manual.mp4').category).toBe('generic');
  });
});

describe('bounded unique-resource priority traversal', () => {
  it('expands the scoped index and captures its unknown-role child ahead of pending support', async () => {
    const { result, selected, calls } = await run(
      anchor('/a-support', 'Support') +
        manual('/Device-ZX/index.html') +
        manual('/Other/index.html'),
      {
        '/Device-ZX/index.html': anchor(
          'technical-specifications.html',
          'Technical specifications',
        ),
      },
      { max_recursion_depth: 1, max_captured_candidates: 2 },
    );
    expect(selected).toEqual(['/Device-ZX/index.html', '/Device-ZX/technical-specifications.html']);
    expect(
      result.candidates.find((x) =>
        x.candidate.normalized_uri.endsWith('technical-specifications.html'),
      )?.candidate.role,
    ).toBe('unknown');
    expect(calls).toHaveLength(3); // Seed plus exactly two captures; no ranking fetches.
  });
  it('changes admission membership through child discovery and replays identically', async () => {
    const seed =
      anchor('/a-support', 'Support') +
      manual('/Device-ZX/index.html') +
      anchor('/z-manual.html', 'Manual');
    const docs = {
      '/Device-ZX/index.html': anchor('technical-specifications.html', 'Technical specifications'),
    };
    const options = {
      max_recursion_depth: 1,
      max_discovered_candidates: 2,
      max_captured_candidates: 1,
    };
    const first = await run(seed, docs, options);
    const second = await run(seed, docs, options);
    expect(
      first.result.candidates.map((x) => new URL(x.candidate.normalized_uri).pathname),
    ).toEqual(['/Device-ZX/index.html', '/Device-ZX/technical-specifications.html']);
    expect(first.result.artifact?.deterministic_snapshot).toBe(
      second.result.artifact?.deterministic_snapshot,
    );
    expect(first.selected).toEqual(second.selected);
  });
  it('caps fifty distinct resources and twenty captures, retaining admitted uncaptured evidence', async () => {
    const seed = Array.from({ length: 65 }, (_, i) => anchor(`/manual-${i}.html`, 'Manual')).join(
      '',
    );
    const { result, selected, calls } = await run(seed);
    expect(new Set(result.candidates.map((x) => x.candidate.normalized_uri)).size).toBe(50);
    expect(selected).toHaveLength(20);
    expect(calls).toHaveLength(21);
    expect(
      result.candidates.filter((x) => x.candidate.selection_status === 'discovered'),
    ).toHaveLength(30);
  });
  it('does not give repeated occurrences priority votes and preserves bounded provenance', async () => {
    const base =
      anchor('/support', 'Support') +
      anchor('/technical-specifications.html', 'Technical specifications');
    const original = await run(base, {}, { max_captured_candidates: 1 });
    const repeated = await run(
      base + anchor('/support', 'Support').repeat(100),
      {},
      { max_captured_candidates: 1 },
    );
    expect(repeated.selected).toEqual(original.selected);
    expect(
      repeated.result.candidates.filter((x) => x.candidate.normalized_uri.endsWith('/support')),
    ).toHaveLength(8);
  });
  it('shares one capture between direct and child occurrences and suppresses redirect aliases', async () => {
    const seed =
      manual('/Device-ZX/index.html') +
      anchor('/Device-ZX/technical-specifications.html', 'Technical specifications') +
      anchor('/Device-ZX/z-specifications.html', 'Specifications');
    const { result, calls } = await run(
      seed,
      {
        '/Device-ZX/index.html': anchor(
          'technical-specifications.html#child',
          'Technical specifications',
        ),
      },
      { max_recursion_depth: 1 },
      { '/Device-ZX/technical-specifications.html': '/Device-ZX/z-specifications.html' },
    );
    expect(calls.filter((x) => x.endsWith('/technical-specifications.html'))).toHaveLength(1);
    expect(calls.some((x) => x.endsWith('/z-specifications.html'))).toBe(false);
    expect(
      result.candidates.filter((x) => x.candidate.selection_status === 'duplicate_uri'),
    ).toHaveLength(2);
  });
  it('keeps default depth zero and does not expand grandchildren at depth one', async () => {
    const seed = manual('/Device-ZX/index.html');
    const docs = {
      '/Device-ZX/index.html': manual('/Device-ZX/installation.html'),
      '/Device-ZX/installation.html': anchor('/Device-ZX/grandchild-manual.html', 'Manual'),
    };
    expect((await run(seed, docs)).result.candidates).toHaveLength(1);
    const one = await run(seed, docs, { max_recursion_depth: 1 });
    expect(one.result.candidates).toHaveLength(2);
    expect(one.calls.some((x) => x.includes('grandchild'))).toBe(false);
  });
});
