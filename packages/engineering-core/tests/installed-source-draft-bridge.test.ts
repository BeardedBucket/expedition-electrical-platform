import { describe, it, expect } from 'vitest';
import { completeInstalledSystemFixture } from './fixtures/whole-system.js';
import {
  bindInstalledSourceDrafts,
  evaluateInstalledSourceDrafts,
  replayInstalledSourceDrafts,
  type InstalledSourceDraftScenario,
} from '../src/installed-source-draft-bridge.js';
import {
  parseSourceGroundedDraft,
  type SourceGroundedDraft,
} from '../src/source-grounded-draft.js';
import { passportDigest } from '../src/portable-json.js';
import { generateArchitectures } from '../src/architecture-generation.js';
import { evaluateProductSelection, bindProductSelection } from '../src/product-selection.js';

// Invented project-owned source/rating/installation fixtures. No genuine source,
// product review or content-bound verification is represented by these hashes.
function fixture() {
  const f = completeInstalledSystemFixture();
  const record = f.catalog.find((r) => r.id === 'fixture.reduce')!;
  const draft: SourceGroundedDraft = {
    version: 'source-grounded-draft.v1',
    authority: 'codex_prepared_unreviewed',
    product: {
      id: record.id,
      manufacturer: record.manufacturer,
      model: record.model,
      manufacturer_part_number: null,
      hardware_revision: null,
    },
    intended_use: 'Synthetic conditional conversion diagnostic',
    sources: [
      {
        id: 'synthetic.source',
        url: 'https://example.test/synthetic',
        publisher: record.manufacturer,
        model: record.model,
        retrieved_at: '2026-10-13T00:00:00Z',
        content_digest: 'sha256:' + 'a'.repeat(64),
        document_revision: null,
        identity_locator: 'Invented model header',
        rights: 'metadata_and_limited_facts_only',
        redistribution_grant: 'not_established',
      },
    ],
    facts: [
      {
        id: 'synthetic.input',
        quantity: 'input_voltage_range',
        basis: 'operating',
        mode: 'conversion',
        direction: 'input',
        electrical_domain: 'dc',
        original: {
          value: '{"min":20,"max":30}',
          unit: 'V',
          presentation: 'source_value_reconstruction',
        },
        normalized: { value: { min: 20, max: 30 }, unit: 'V' },
        normalization: 'identity',
        source_id: 'synthetic.source',
        locator: 'Invented source row',
        context_digest: 'sha256:' + 'a'.repeat(64),
        conditions: [],
        unresolved_conditions: [],
        disposition: 'typed_consumer',
      },
    ],
    holds: ['Invented test only'],
  };
  record.verification_status = 'unverified';
  record.engineering_profile = {
    schema_version: 'engineering-profile.v1',
    component_id: record.id,
    model: record.model,
    manufacturer_revision: null,
    evidence: [],
    source_specification: draft,
  };
  const requirement = {
    quantity: 'input_voltage_range',
    mode: 'conversion',
    direction: 'input' as const,
    electrical_domain: 'dc' as const,
    unit: 'V',
    value: 24,
    predicate: 'within_range' as const,
    conditions: [],
  };
  const scenario: InstalledSourceDraftScenario = {
    version: 'installed-source-draft-scenario.v1',
    uses: [{ instance_id: 'reduce', requirements: [requirement] }],
  };
  return { ...f, record, draft, scenario, requirement };
}
describe('source-grounded draft installed consumers', () => {
  it('requires literal phase identity before any definite installed comparison', () => {
    const f = fixture();
    const fact = f.draft.facts[0]!;
    Object.assign(fact, {
      quantity: 'ac_phase',
      basis: 'descriptive',
      electrical_domain: 'ac',
      original: { value: 'single_phase', unit: 'text', presentation: 'source_literal' },
      normalized: { value: 'single_phase', unit: 'text' },
    });
    Object.assign(f.requirement, {
      quantity: 'ac_phase',
      electrical_domain: 'ac',
      unit: 'text',
      value: 'single_phase',
      predicate: 'equals',
    });
    const faithful = evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario);
    expect(faithful.binding.checks.find((c) => c.quantity === 'ac_phase')?.status).toBe('ELIGIBLE');
    expect(faithful.binding.status).toBe('UNRESOLVED');
    expect(replayInstalledSourceDrafts(faithful)).toEqual(faithful);
    fact.original.value = 'three_phase';
    expect(() => parseSourceGroundedDraft(f.draft)).toThrow();
    expect(() => evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario)).toThrow();
    const forged = structuredClone(faithful);
    forged.binding.catalog.find(
      (r) => r.id === f.record.id,
    )!.engineering_profile!.source_specification!.facts[0]!.original.value = 'three_phase';
    const { digest: _digest, ...body } = forged;
    forged.digest = passportDigest(body);
    expect(() => replayInstalledSourceDrafts(forged)).toThrow();
  });
  it.each(['unit', 'boolean', 'range', 'text_number'] as const)(
    'refuses an undeclared literal %s mapping',
    (kind) => {
      const f = fixture(),
        fact = f.draft.facts[0]!;
      fact.original = { value: 'single_phase', unit: 'text', presentation: 'source_literal' };
      fact.normalized = { value: 'single_phase', unit: 'text' };
      if (kind === 'unit') fact.normalized.unit = 'V';
      if (kind === 'boolean') {
        fact.original.value = 'true';
        fact.normalized.value = true;
      }
      if (kind === 'range') {
        fact.original.value = '{"min":20,"max":30}';
        fact.normalized.value = { min: 20, max: 30 };
      }
      if (kind === 'text_number') fact.normalized.value = 0;
      expect(() => parseSourceGroundedDraft(f.draft)).toThrow();
    },
  );
  it('preserves literal numbers, explicit conversions, reconstructed ranges and authored summaries', () => {
    const f = fixture(),
      fact = f.draft.facts[0]!;
    expect(parseSourceGroundedDraft(f.draft).facts[0]!.normalized.value).toEqual({
      min: 20,
      max: 30,
    });
    fact.original = { value: '20', unit: 'V', presentation: 'source_literal' };
    fact.normalized = { value: 20, unit: 'V' };
    expect(parseSourceGroundedDraft(f.draft).facts[0]!.normalized.value).toBe(20);
    fact.normalized.value = 21;
    expect(() => parseSourceGroundedDraft(f.draft)).toThrow();
    fact.original = { value: '2', unit: 'cm', presentation: 'source_literal' };
    fact.normalized = { value: 20, unit: 'mm' };
    fact.normalization = 'cm_to_mm';
    expect(parseSourceGroundedDraft(f.draft).facts[0]!.normalized.value).toBe(20);
    fact.original = { value: '25 ± 5', unit: 'degC', presentation: 'source_literal' };
    fact.normalized = { value: { min: 20, max: 30 }, unit: 'degC' };
    fact.normalization = 'symmetric_range';
    expect(parseSourceGroundedDraft(f.draft).facts[0]!.normalized.value).toEqual({
      min: 20,
      max: 30,
    });
    fact.original = {
      value: 'Author description of one AC phase',
      unit: 'text',
      presentation: 'authored_summary',
    };
    fact.normalized = { value: 'single_phase', unit: 'text' };
    fact.normalization = 'identity';
    expect(parseSourceGroundedDraft(f.draft).facts[0]!.original.presentation).toBe(
      'authored_summary',
    );
  });
  it('rejects inverted quantity predicates and negative current demands', () => {
    const f = fixture();
    f.requirement.predicate = 'at_most' as never;
    expect(() => evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario)).toThrow(
      'predicate',
    );
    f.requirement.quantity = 'output_current';
    f.requirement.unit = 'A';
    f.requirement.value = -1;
    expect(() => evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario)).toThrow(
      'nonnegative',
    );
  });
  it('distinguishes unknown installed/source revisions from a known contradiction', () => {
    const f = fixture();
    f.record.manufacturer_revision = 'R2';
    expect(bindInstalledSourceDrafts(f.input, f.catalog, f.scenario).status).toBe('UNRESOLVED');
    f.draft.product.hardware_revision = 'R1';
    f.record.engineering_profile!.manufacturer_revision = 'R1';
    expect(bindInstalledSourceDrafts(f.input, f.catalog, f.scenario).status).toBe('BLOCKED');
    expect(() => evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario)).toThrow();
  });
  it.each([
    [19, 'BLOCKED'],
    [20, 'UNRESOLVED'],
    [30, 'UNRESOLVED'],
    [31, 'BLOCKED'],
  ] as const)('handles inclusive input %s V while retaining authority', (v, status) => {
    const f = fixture();
    f.requirement.value = v;
    const result = evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario);
    expect(result.binding.status).toBe(status);
    expect(
      result.passport.decisions.find((d) => d.id === 'inherited:installed_source_drafts')?.status,
    ).toBe(status.toLowerCase());
    expect(replayInstalledSourceDrafts(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });
  it('requires all source applicability before a negative limit, with unrelated NO precedence', () => {
    const f = fixture();
    f.draft.facts[0]!.conditions = [
      { key: 'ambient_temperature_c', value: { min: 20, max: 30 }, unit: 'degC' },
    ];
    f.requirement.value = 40;
    expect(evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario).binding.status).toBe(
      'UNRESOLVED',
    );
    f.requirement.conditions = [{ key: 'ambient_temperature_c', value: 25, unit: 'degC' }] as never;
    expect(evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario).binding.status).toBe(
      'BLOCKED',
    );
    f.requirement.conditions = [{ key: 'ambient_temperature_c', value: 35, unit: 'degC' }] as never;
    expect(evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario).binding.status).toBe(
      'UNRESOLVED',
    );
  });
  it.each(['mode', 'domain', 'direction', 'unit', 'ambiguity'] as const)(
    'does not borrow %s',
    (kind) => {
      const f = fixture();
      if (kind === 'mode') f.requirement.mode = 'bypass';
      if (kind === 'domain')
        (f.requirement as { electrical_domain: string }).electrical_domain = 'ac';
      if (kind === 'direction') (f.requirement as { direction: string }).direction = 'output';
      if (kind === 'unit') f.requirement.unit = 'A';
      if (kind === 'ambiguity') f.draft.facts[0]!.disposition = 'evidence_ambiguity';
      expect(evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario).binding.status).toBe(
        'UNRESOLVED',
      );
    },
  );
  it('rejects unknown schema members and rehashed tampering, owning result copies', () => {
    const f = fixture();
    expect(() =>
      evaluateInstalledSourceDrafts(f.input, f.catalog, {
        ...f.scenario,
        unexpected: true,
      } as never),
    ).toThrow();
    const result = evaluateInstalledSourceDrafts(f.input, f.catalog, f.scenario);
    f.draft.facts[0]!.normalized.value = 99;
    expect(replayInstalledSourceDrafts(result)).toEqual(result);
    result.binding.status = 'BLOCKED';
    const { digest: _digest, ...body } = result;
    result.digest = passportDigest(body);
    expect(() => replayInstalledSourceDrafts(result)).toThrow('replay');
  });
  it('fails closed on foreign model, reversed ranges and claimed human authority', () => {
    const f = fixture();
    const d = structuredClone(f.draft);
    d.sources[0]!.model = 'other';
    expect(() => parseSourceGroundedDraft(d)).toThrow('Foreign');
    d.sources[0]!.model = d.product.model;
    d.facts[0]!.normalized.value = { min: 30, max: 20 };
    expect(() => parseSourceGroundedDraft(d)).toThrow('Reversed');
    (d as unknown as { authority: string }).authority = 'approved';
    expect(() => parseSourceGroundedDraft(d)).toThrow();
  });
  it('binds the same source gate through actual Phase5 and preserves earlier holds', () => {
    const f = fixture();
    const generation = generateArchitectures({
      schema_version: '2.0.0',
      assumptions: [],
      requirements: {
        id: 'synthetic.source.selection',
        fixed_house_voltage_v: 24,
        loads: [
          { id: 'load12', domain: { kind: 'dc', nominal_voltage_v: 12 }, required_power_w: 50 },
        ],
        charging_sources: [],
        storage: { required: false },
      },
    });
    const selection = evaluateProductSelection({
      schema_version: '1.0.0',
      generation,
      candidate_id: generation.candidates[0]!.id,
      corpus: [f.record],
      fixed_existing: [],
      assemblies: [],
    });
    const role = selection.roles[0]!;
    const binding = role.candidates[0]!.bindings.find(
      (b) =>
        Object.values(b.witness.interfaces).includes('input') &&
        Object.values(b.witness.interfaces).every((v) => v !== null) &&
        Object.values(b.witness.paths).every((v) => v !== null),
    )!;
    expect(binding).toBeDefined();
    f.scenario.uses[0]!.instance_id = role.role.id;
    f.requirement.value = 40;
    const bound = bindProductSelection(
      selection,
      [{ role_id: role.role.id, component_id: f.record.id, binding_id: binding.id }],
      { installed_source_drafts: f.scenario },
    );
    expect(bound.source_draft_binding?.status).toBe('BLOCKED');
    expect(bound.input.requirements.mandatory_conditions?.some((c) => c.id === role.role.id)).toBe(
      true,
    );
    expect(
      bound.input.requirements.mandatory_conditions?.find((c) => c.id === 'installed_source_drafts')
        ?.status,
    ).toBe('blocked');
  });
});
