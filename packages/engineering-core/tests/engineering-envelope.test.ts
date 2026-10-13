import { describe, it, expect } from 'vitest';
import { engineeringProfileErrors, parseEngineeringProfile } from '../src/engineering-profile.js';
import { evaluateEngineeringEnvelope } from '../src/engineering-envelope.js';
import {
  buildPortableEngineeringEnvelope,
  replayEngineeringEnvelope,
} from '../src/engineering-envelope-replay.js';
import {
  validateComponentLibraryRecord,
  normalizeComponentLibraryRecord,
} from '../src/component-library.js';
import { passportDigest } from '../src/portable-json.js';
import {
  solarFixture,
  multifunctionFixture,
  value,
  syntheticProfile,
} from './fixtures/engineering-envelope.js';

describe('Wave-1 controlled synthetic PV envelope', () => {
  it('passes a complete invented single-module model without installation certification', () => {
    const r = evaluateEngineeringEnvelope(solarFixture());
    expect(r.status).toBe('ELIGIBLE');
    expect(r.authority).toBe('controlled_synthetic');
    expect(r.installation_safety).toBe('not_evaluated');
    expect(r.calculations.find((c) => c.id === 'tracker.cold_voc')?.value).toBeCloseTo(27.40684, 8);
  });
  it('blocks four high-voltage modules despite permitted power clipping', () => {
    const r = evaluateEngineeringEnvelope(solarFixture(4, 1, true));
    expect(r.status).toBe('BLOCKED');
    expect(r.checks.find((c) => c.code === 'absolute_cold_voc')?.actual).toBeCloseTo(219.25472, 8);
    expect(r.checks.find((c) => c.code === 'conditional_pv_power')?.explanation).toContain(
      'clipping permitted',
    );
  });
  it('blocks excessive parallel PV Isc independently of battery output current', () => {
    const r = evaluateEngineeringEnvelope(solarFixture(1, 5));
    expect(r.checks.find((c) => c.code === 'pv_short_circuit_current')?.actual).toBeCloseTo(
      51.55,
      8,
    );
    expect(r.status).toBe('BLOCKED');
  });
  it('blocks hot run margin while retaining a passing reference startup', () => {
    const x = solarFixture();
    x.pv!.cell_max_c = 80;
    const r = evaluateEngineeringEnvelope(x);
    expect(r.calculations.find((c) => c.id === 'tracker.hot_vmp')?.value).toBeCloseTo(16.1772, 8);
    expect(r.checks.find((c) => c.code === 'run_headroom')?.status).toBe('BLOCKED');
    expect(r.checks.find((c) => c.code === 'start_headroom')?.status).toBe('ELIGIBLE');
  });
  it.each([
    [4, 1, 109.62736, 10.31],
    [1, 4, 27.40684, 41.24],
    [2, 2, 54.81368, 20.62],
  ])('distinguishes %iS%iP at equal reference watts', (ns, np, v, i) => {
    const r = evaluateEngineeringEnvelope(solarFixture(ns, np));
    expect(r.calculations.find((c) => c.id === 'tracker.cold_voc')?.value).toBeCloseTo(v, 8);
    expect(r.checks.find((c) => c.code === 'pv_short_circuit_current')?.actual).toBeCloseTo(i, 8);
    expect(r.calculations.find((c) => c.id === 'tracker.reference_power')?.value).toBe(800);
  });
  it('withholds mixed string/parallel modeling', () => {
    const x = solarFixture(2, 2);
    x.profiles.push(syntheticProfile('other'));
    x.pv!.strings[1]!.module_id = 'other';
    expect(
      evaluateEngineeringEnvelope(x).checks.some(
        (c) => c.code === 'heterogeneous_tracker_unmodeled',
      ),
    ).toBe(true);
  });
  it.each([
    'vocCoefficient',
    'reference',
    'absolute',
    'vmpCoefficient',
    'pvCurrent',
    'tracker',
    'uncertainty',
    'irradiance',
    'cellRationale',
    'currentFactor',
    'protection',
    'restart',
  ])('abstains for missing %s', (missing) => {
    const x = solarFixture();
    const m = x.profiles[0]!.pv!,
      t = x.profiles[1]!.trackers![0]!;
    if (missing === 'vocCoefficient') delete m.coefficients!.voc;
    if (missing === 'reference') delete m.reference_cell_c;
    if (missing === 'absolute') delete t.absolute_voc_v;
    if (missing === 'vmpCoefficient') delete m.coefficients!.vmp;
    if (missing === 'pvCurrent') delete t.max_isc_a;
    if (missing === 'tracker') delete x.profiles[1]!.trackers;
    if (missing === 'uncertainty') delete m.uncertainty_fraction;
    if (missing === 'irradiance') delete m.irradiance_w_m2;
    if (missing === 'cellRationale') delete x.pv!.cell_temperature_rationale;
    if (missing === 'currentFactor') delete x.pv!.current_upper_factors;
    if (missing === 'protection') delete x.pv!.protection_and_connector_evidence_ids;
    if (missing === 'restart') delete t.restart_headroom_v;
    expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
  });
  it('never substitutes a power coefficient for Vmp', () => {
    const x = solarFixture();
    delete x.profiles[0]!.pv!.coefficients!.vmp;
    x.profiles[0]!.pv!.coefficients!.pmax = {
      value: -0.38,
      unit: 'percent/K',
      cell_domain_c: { min: -40, max: 85 },
      evidence_ids: ['module.e'],
    };
    expect(
      evaluateEngineeringEnvelope(x).checks.find((c) => c.code === 'hot_vmp_prerequisites')?.status,
    ).toBe('UNRESOLVED');
  });
  it('does not infer tracker independence from two connectors', () => {
    const x = solarFixture(1, 5);
    const t = x.profiles[1]!.trackers![0]!;
    t.terminal_ids!.push('second');
    t.terminal_limits!.push({
      id: 'second',
      max_isc_a: value('controller', 45, 'A'),
      max_imp_a: value('controller', 45, 'A'),
    });
    x.pv!.strings[3]!.terminal_id = 'second';
    x.pv!.strings[4]!.terminal_id = 'second';
    expect(
      evaluateEngineeringEnvelope(x).checks.find((c) => c.code === 'pv_short_circuit_current')
        ?.status,
    ).toBe('BLOCKED');
  });
  it('isolates different homogeneous modules only on independently evidenced trackers', () => {
    const x = solarFixture();
    const other = syntheticProfile('other');
    other.pv = JSON.parse(
      JSON.stringify(solarFixture(1, 1, true).profiles[0]!.pv).replaceAll('module.e', 'other.e'),
    );
    x.profiles.push(other);
    const second = structuredClone(x.profiles[1]!.trackers![0]!);
    second.id = 'second';
    second.terminal_ids = ['input2'];
    second.terminal_limits![0]!.id = 'input2';
    x.profiles[1]!.trackers!.push(second);
    x.pv!.strings.push({
      id: 'second_string',
      module_id: 'other',
      series_count: 1,
      tracker_id: 'second',
      terminal_id: 'input2',
    });
    expect(evaluateEngineeringEnvelope(x).status).toBe('ELIGIBLE');
  });
  it('rejects colliding evidence IDs instead of emitting an ambiguous trace', () => {
    const x = solarFixture();
    const other = syntheticProfile('other');
    other.evidence[0]!.id = 'module.e';
    x.profiles.push(other);
    expect(() => evaluateEngineeringEnvelope(x)).toThrow('Ambiguous envelope evidence IDs');
  });
  it('accepts exact equality and blocks the next representable exceedance without rounding', () => {
    const x = solarFixture();
    const cold = evaluateEngineeringEnvelope(x).checks.find(
      (c) => c.code === 'absolute_cold_voc',
    )!.actual!;
    x.profiles[1]!.trackers![0]!.absolute_voc_v!.value = cold;
    expect(evaluateEngineeringEnvelope(x).status).toBe('ELIGIBLE');
    x.profiles[1]!.trackers![0]!.absolute_voc_v!.value = cold - 0.000000001;
    expect(evaluateEngineeringEnvelope(x).status).toBe('BLOCKED');
  });
  it('applies published voltage uncertainty before comparing', () => {
    const x = solarFixture();
    x.profiles[0]!.pv!.uncertainty_fraction!.voc!.value = 0.1;
    x.profiles[1]!.trackers![0]!.absolute_voc_v!.value = 28;
    expect(evaluateEngineeringEnvelope(x).status).toBe('BLOCKED');
  });
  it('withholds extrapolation and rejects foreign model evidence', () => {
    const x = solarFixture();
    x.pv!.cell_min_c = -41;
    expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
    x.profiles[0]!.evidence[0]!.model = 'sibling';
    expect(() => evaluateEngineeringEnvelope(x)).toThrow('ownership');
  });
  it('uses the worst endpoint for a positive coefficient and refuses unproved grouping', () => {
    const x = solarFixture();
    x.profiles[0]!.pv!.coefficients!.voc!.value = 0.36;
    x.pv!.cell_max_c = 80;
    x.profiles[1]!.trackers![0]!.absolute_voc_v!.value = 28;
    expect(
      evaluateEngineeringEnvelope(x).checks.find((c) => c.code === 'absolute_cold_voc')?.status,
    ).toBe('BLOCKED');
    x.profiles[1]!.trackers![0]!.grouping_status = 'unresolved';
    expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
  });
  it('normalizes percent and absolute coefficients only in the calculation trace', () => {
    const x = solarFixture();
    const beta = x.profiles[0]!.pv!.coefficients!.voc!;
    const original = evaluateEngineeringEnvelope(x).calculations[0]!.value;
    beta.value = -0.0036 * 24.34;
    beta.unit = 'V/K';
    expect(evaluateEngineeringEnvelope(x).calculations[0]!.value).toBe(original);
    expect(beta.unit).toBe('V/K');
  });
  it('rejects invalid units, detached evidence, nonfinite inputs and unsupported versions', () => {
    const x = solarFixture();
    (x.profiles[0]!.pv!.voc_v as { unit: string }).unit = 'A';
    expect(engineeringProfileErrors(x.profiles[0])).not.toEqual([]);
    const y = solarFixture();
    y.profiles[0]!.pv!.voc_v!.evidence_ids = ['foreign'];
    expect(() => evaluateEngineeringEnvelope(y)).toThrow('missing evidence');
    const z = solarFixture();
    z.pv!.cell_min_c = NaN;
    expect(() => evaluateEngineeringEnvelope(z)).toThrow('Nonfinite');
    expect(() =>
      parseEngineeringProfile({
        ...solarFixture().profiles[0],
        schema_version: 'engineering-profile.v2',
      }),
    ).toThrow();
  });
});

describe('Wave-1 multifunction selected mode and assembly', () => {
  it('passes the complete invented fixture', () =>
    expect(evaluateEngineeringEnvelope(multifunctionFixture()).status).toBe('ELIGIBLE'));
  it('blocks combined overload and mutually excluded paths', () => {
    const x = multifunctionFixture();
    x.operating!.demands.push({ path_id: 'dc', value: 1500, unit: 'W' });
    const r = evaluateEngineeringEnvelope(x);
    expect(r.status).toBe('BLOCKED');
    expect(r.checks.find((c) => c.code === 'combined_capacity')?.actual).toBe(6500);
    expect(r.checks.find((c) => c.code === 'simultaneous_exclusion')?.status).toBe('BLOCKED');
  });
  it.each([
    'mode',
    'count',
    'temperature',
    'unit',
    'inventory',
    'neutral',
    'ground',
    'protocol',
    'revision',
    'module',
  ])('withholds unresolved %s', (missing) => {
    const x = multifunctionFixture();
    const op = x.operating!,
      p = x.profiles[0]!;
    if (missing === 'mode') delete op.mode;
    if (missing === 'count') delete op.battery_count;
    if (missing === 'temperature') delete op.temperature_c;
    if (missing === 'unit') op.demands[0]!.unit = 'VA';
    if (missing === 'inventory') delete op.required_capacity_group_ids;
    if (missing === 'neutral') delete p.ac_modes![0]!.neutral_evidence_ids;
    if (missing === 'ground') delete p.ac_modes![0]!.grounding_evidence_ids;
    if (missing === 'protocol') delete op.installed_modules![0]!.protocol;
    if (missing === 'revision') op.installed_modules![0]!.revision = null;
    if (missing === 'module') op.installed_modules = [];
    expect(evaluateEngineeringEnvelope(x).status).toBe('UNRESOLVED');
  });
  it('distinguishes 240V bypass from 120V inversion and wrong phase/leg', () => {
    const x = multifunctionFixture();
    const m = x.profiles[0]!.ac_modes![0]!;
    m.relationship = 'same_phase_legs';
    m.line_line_v = value('hub', 0, 'V');
    expect(evaluateEngineeringEnvelope(x).status).toBe('BLOCKED');
    m.kind = 'bypass';
    m.source_required = true;
    x.operating!.source_present = false;
    expect(
      evaluateEngineeringEnvelope(x).checks.find((c) => c.code === 'ac_source_dependency')?.status,
    ).toBe('BLOCKED');
    x.operating!.source_present = true;
    x.operating!.source_relationship = 'split_phase';
    x.operating!.source_line_neutral_v = 120;
    expect(
      evaluateEngineeringEnvelope(x).checks.find((c) => c.code === 'bypass_source_context')?.status,
    ).toBe('BLOCKED');
  });
  it('blocks per-leg overload without inventing neutral current', () => {
    const x = multifunctionFixture();
    x.operating!.ac_loads = [
      {
        connection: 'line_neutral',
        voltage_v: 120,
        relationship: 'split_phase',
        leg: 'L2',
        current_a: 26,
      },
    ];
    expect(
      evaluateEngineeringEnvelope(x).checks.find((c) => c.code === 'ac_leg_capacity')?.status,
    ).toBe('BLOCKED');
  });
  it('does not install included packs automatically or require absent optional screens', () => {
    const x = multifunctionFixture();
    expect(evaluateEngineeringEnvelope(x).status).toBe('ELIGIBLE');
    x.operating!.installed_modules![0]!.count = 1;
    expect(evaluateEngineeringEnvelope(x).status).toBe('BLOCKED');
  });
  it('keeps genuine/provisional examples unresolved regardless of subcheck passes', () => {
    const x = multifunctionFixture();
    x.profiles[0]!.evidence[0]!.origin = 'source_stated';
    x.profiles[0]!.evidence[0]!.rights = 'metadata_and_limited_facts_only';
    const r = evaluateEngineeringEnvelope(x);
    expect(r.envelope_status).toBe('ELIGIBLE');
    expect(r.authority).toBe('provisional');
    expect(r.status).toBe('UNRESOLVED');
  });
});

describe('Versioned profile canonical validation and portable replay', () => {
  it('accepts old records without migration and preserves a typed additive profile', () => {
    const p = solarFixture().profiles[0]!;
    const old = {
      id: p.component_id,
      manufacturer: 'Synthetic',
      model: p.model,
      verification_status: 'unverified',
    };
    expect(validateComponentLibraryRecord(old).ok).toBe(true);
    expect(normalizeComponentLibraryRecord(old).engineering_profile).toBeUndefined();
    const modern = {
      ...old,
      manufacturer_revision: p.manufacturer_revision,
      engineering_profile: p,
    };
    expect(validateComponentLibraryRecord(modern).ok).toBe(true);
    expect(normalizeComponentLibraryRecord(modern).engineering_profile).toEqual(p);
    expect(validateComponentLibraryRecord({ ...modern, model: 'sibling' }).ok).toBe(false);
  });
  it('replays exact current bytes and refuses rehashed result forgery or version changes', () => {
    const p = buildPortableEngineeringEnvelope(solarFixture());
    expect(replayEngineeringEnvelope(JSON.parse(JSON.stringify(p)))).toEqual(p);
    p.result.status = 'BLOCKED';
    const { digest: _digest, ...content } = p;
    p.digest = passportDigest(content);
    expect(() => replayEngineeringEnvelope(p)).toThrow('replay');
    expect(() =>
      replayEngineeringEnvelope({ ...p, schema_version: 'portable-engineering-envelope.v3' }),
    ).toThrow('Unsupported');
  });
});
