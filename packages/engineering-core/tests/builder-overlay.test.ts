import { describe, expect, it } from 'vitest';
import {
  evaluateBuilderAttribution,
  evaluateBuilderCatalogMode,
  evaluateGenericBuilderMode,
  normalizeBuilderProfileRecord,
  parseBuilderProfileText,
  routeBuilderInquiry,
  validateBuilderProfileRecord,
} from '../src/index.js';

const makeProfile = (overrides: Record<string, unknown> = {}) =>
  normalizeBuilderProfileRecord({
    builder_id: 'example-builder',
    display_name: 'Example Builder',
    inventory_mode: 'allowlist',
    catalog: [],
    ...overrides,
  });

const makeCandidate = (
  id: string,
  overrides: Record<string, unknown> = {},
): {
  readonly id: string;
  readonly eligible?: boolean;
  readonly engineeringEligible?: boolean;
  readonly safetyEligible?: boolean;
  readonly advisoryEligible?: boolean;
  readonly status?: 'eligible' | 'ineligible' | 'unknown';
} => ({
  id,
  eligible: true,
  ...overrides,
});

describe('builder overlay rules', () => {
  it('generic mode returns all globally eligible candidates', () => {
    const result = evaluateGenericBuilderMode([
      makeCandidate('component.a'),
      makeCandidate('component.b'),
      makeCandidate('component.c', { eligible: false }),
    ]);

    expect(result.status).toBe('generic');
    expect(result.candidates.map((candidate) => candidate.componentId)).toEqual([
      'component.a',
      'component.b',
    ]);
  });

  it('engineering-incompatible candidate cannot be re-included', () => {
    const profile = makeProfile({
      catalog: [{ component_id: 'component.a', availability: 'stocked', preference: 'preferred' }],
    });

    const result = evaluateBuilderCatalogMode(
      profile,
      [makeCandidate('component.a', { engineeringEligible: false })],
      { kind: 'resolved', builderId: profile.builderId },
    );

    expect(result.status).toBe('ineligible');
  });

  it('advisory/safety-excluded candidate cannot be re-included', () => {
    const profile = makeProfile({
      catalog: [{ component_id: 'component.a', availability: 'stocked', preference: 'preferred' }],
    });

    const result = evaluateBuilderCatalogMode(
      profile,
      [makeCandidate('component.a', { safetyEligible: false, advisoryEligible: false })],
      { kind: 'resolved', builderId: profile.builderId },
    );

    expect(result.status).toBe('ineligible');
  });

  it('builder filtering occurs after global eligibility', () => {
    const profile = makeProfile({
      catalog: [{ component_id: 'component.a', availability: 'stocked', preference: 'preferred' }],
    });

    const result = evaluateBuilderCatalogMode(
      profile,
      [makeCandidate('component.a'), makeCandidate('component.b')],
      { kind: 'resolved', builderId: profile.builderId },
    );

    expect(result.status).toBe('eligible');
    expect(result.rankedCandidates.map((candidate) => candidate.componentId)).toEqual([
      'component.a',
    ]);
  });

  it('unavailable is excluded', () => {
    const profile = makeProfile({
      catalog: [
        { component_id: 'component.a', availability: 'unavailable', preference: 'standard' },
      ],
    });

    const result = evaluateBuilderCatalogMode(profile, [makeCandidate('component.a')], {
      kind: 'resolved',
      builderId: profile.builderId,
    });

    expect(result.status).toBe('inventory_gap');
    expect(result.candidates[0]?.status).toBe('ineligible');
  });

  it('discontinued is excluded', () => {
    const profile = makeProfile({
      catalog: [
        { component_id: 'component.a', availability: 'discontinued', preference: 'standard' },
      ],
    });

    const result = evaluateBuilderCatalogMode(profile, [makeCandidate('component.a')], {
      kind: 'resolved',
      builderId: profile.builderId,
    });

    expect(result.status).toBe('inventory_gap');
  });

  it('special_order remains eligible and labeled', () => {
    const profile = makeProfile({
      catalog: [
        { component_id: 'component.a', availability: 'special_order', preference: 'preferred' },
      ],
    });

    const result = evaluateBuilderCatalogMode(profile, [makeCandidate('component.a')], {
      kind: 'resolved',
      builderId: profile.builderId,
    });

    expect(result.status).toBe('eligible');
    expect(result.rankedCandidates[0]?.availability).toBe('special_order');
  });

  it('preferred affects ordering only', () => {
    const profile = makeProfile({
      catalog: [
        { component_id: 'component.b', availability: 'stocked', preference: 'standard' },
        { component_id: 'component.a', availability: 'stocked', preference: 'preferred' },
      ],
    });

    const result = evaluateBuilderCatalogMode(
      profile,
      [makeCandidate('component.a'), makeCandidate('component.b')],
      { kind: 'resolved', builderId: profile.builderId },
    );

    expect(result.rankedCandidates.map((candidate) => candidate.componentId)).toEqual([
      'component.a',
      'component.b',
    ]);
  });

  it('preference cannot override incompatibility', () => {
    const profile = makeProfile({
      catalog: [{ component_id: 'component.a', availability: 'stocked', preference: 'preferred' }],
    });

    const result = evaluateBuilderCatalogMode(
      profile,
      [makeCandidate('component.a', { engineeringEligible: false, status: 'ineligible' })],
      { kind: 'resolved', builderId: profile.builderId },
    );

    expect(result.status).toBe('ineligible');
  });

  it('inventory_gap when global eligible products exist but builder has none', () => {
    const profile = makeProfile({
      catalog: [
        { component_id: 'component.a', availability: 'unavailable', preference: 'standard' },
      ],
    });

    const result = evaluateBuilderCatalogMode(profile, [makeCandidate('component.b')], {
      kind: 'resolved',
      builderId: profile.builderId,
    });

    expect(result.status).toBe('inventory_gap');
  });

  it('no global eligible products is not inventory_gap', () => {
    const profile = makeProfile({
      catalog: [{ component_id: 'component.a', availability: 'stocked', preference: 'preferred' }],
    });

    const result = evaluateBuilderCatalogMode(
      profile,
      [makeCandidate('component.a', { eligible: false })],
      { kind: 'resolved', builderId: profile.builderId },
    );

    expect(result.status).toBe('ineligible');
  });

  it('unknown availability stays unknown', () => {
    const profile = makeProfile({
      catalog: [{ component_id: 'component.a', availability: 'unknown', preference: 'standard' }],
    });

    const result = evaluateBuilderCatalogMode(profile, [makeCandidate('component.a')], {
      kind: 'resolved',
      builderId: profile.builderId,
    });

    expect(result.status).toBe('inventory_gap');
    expect(result.candidates[0]?.status).toBe('unknown');
  });

  it('unknown builder ID does not become generic', () => {
    const result = evaluateBuilderCatalogMode(makeProfile(), [makeCandidate('component.a')], {
      kind: 'unresolved',
      builderId: 'missing-builder',
    });

    expect(result.status).toBe('unresolved');
  });

  it('stable component IDs determine identity and do not match by display name alone', () => {
    const profile = makeProfile({
      catalog: [{ component_id: 'component.a', availability: 'stocked', preference: 'preferred' }],
    });

    const result = evaluateBuilderCatalogMode(
      profile,
      [makeCandidate('component.a'), makeCandidate('component.b')],
      { kind: 'resolved', builderId: profile.builderId },
    );

    expect(result.rankedCandidates.map((candidate) => candidate.componentId)).toEqual([
      'component.a',
    ]);
  });

  it('duplicate builder catalog IDs fail validation', () => {
    const invalid = validateBuilderProfileRecord({
      builder_id: 'example-builder',
      display_name: 'Example Builder',
      inventory_mode: 'allowlist',
      catalog: [
        { component_id: 'component.a', availability: 'stocked', preference: 'preferred' },
        { component_id: 'component.a', availability: 'stocked', preference: 'standard' },
      ],
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.join(' ')).toContain('duplicate');
    }
  });

  it('malformed commercial metadata fails validation', () => {
    const invalid = validateBuilderProfileRecord({
      builder_id: 'example-builder',
      display_name: 'Example Builder',
      inventory_mode: 'allowlist',
      catalog: [
        {
          component_id: 'component.a',
          availability: 'stocked',
          preference: 'preferred',
          builder_price: -1,
          currency: 'usd',
          lead_time_days: -2,
        },
      ],
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.join(' ')).toContain('builder_price');
    }
  });

  it('resolved builder inquiry routing uses the builder destination', () => {
    const route = routeBuilderInquiry({ kind: 'resolved', builderId: 'builder-a' });
    expect(route.status).toBe('resolved');
    expect(route.destination).toBe('builder-a');
  });

  it('generic inquiry routing uses the generic destination', () => {
    const route = routeBuilderInquiry({ kind: 'generic' });
    expect(route.status).toBe('generic');
    expect(route.destination).toBe('generic/default');
  });

  it('unresolved builder routing is not generic fallback', () => {
    const route = routeBuilderInquiry({ kind: 'unresolved', builderId: 'missing-builder' });
    expect(route.status).toBe('unresolved');
    expect(route.destination).toBe('unresolved/builder-id');
  });

  it('deterministic ranking and tie-breaking order catalog entries consistently', () => {
    const profile = makeProfile({
      catalog: [
        { component_id: 'component.z', availability: 'stocked', preference: 'standard' },
        { component_id: 'component.a', availability: 'stocked', preference: 'standard' },
      ],
    });

    const result = evaluateBuilderCatalogMode(
      profile,
      [makeCandidate('component.z'), makeCandidate('component.a')],
      { kind: 'resolved', builderId: profile.builderId },
    );

    expect(result.rankedCandidates.map((candidate) => candidate.componentId)).toEqual([
      'component.a',
      'component.z',
    ]);
  });

  it('parses YAML builder configuration text', () => {
    const yaml = `
builder_id: example-builder
display_name: Example Builder
inventory_mode: allowlist
catalog:
  - component_id: component.a
    availability: stocked
    preference: preferred
`;

    const parsed = parseBuilderProfileText(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected a parseable builder profile');
    expect(parsed.value.catalog?.[0]?.component_id).toBe('component.a');
  });

  it('supports generic and resolved builder attribution metadata', () => {
    expect(evaluateBuilderAttribution({ kind: 'generic' }).status).toBe('generic');
    expect(evaluateBuilderAttribution({ kind: 'resolved', builderId: 'builder-a' }).status).toBe(
      'resolved',
    );
    expect(
      evaluateBuilderAttribution({ kind: 'unresolved', builderId: 'builder-missing' }).status,
    ).toBe('unresolved');
  });
});
