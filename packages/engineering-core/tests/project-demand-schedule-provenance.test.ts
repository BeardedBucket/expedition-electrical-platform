import { describe, expect, it } from 'vitest';
import {
  evaluateInstalledSystem,
  parseEngineeringPassport,
  serializeEngineeringPassport,
  replayEngineeringPassport,
  type EngineeringPassport,
} from '../src/engineering-passport.js';
import { bindProductSelection } from '../src/product-selection-handoff.js';
import { generateArchitectures } from '../src/architecture-generation.js';
import { evaluateProductSelection } from '../src/product-selection.js';
import {
  evaluateRecommendation,
  parseRecommendation,
  serializeRecommendation,
  replayRecommendation,
} from '../src/recommendation.js';
import { passportDigest, serializePassportValue } from '../src/portable-json.js';
import {
  recommendationRequest,
  recommendationSource,
  tradeoffProduct,
} from './fixtures/recommendation.js';

const fixture = (upstream = false) => {
  const source = recommendationSource([tradeoffProduct()], false, upstream);
  const request = recommendationRequest([source]);
  const result = evaluateRecommendation(request);
  const option = result.options[0]!;
  return { source, request, result, option, passport: option.passport };
};
const demand = (p: EngineeringPassport) => p.input.requirements.project_demands![0]!;
const decision = (p: EngineeringPassport) =>
  p.decisions.find((d) => d.id === `project-demand:${demand(p).id}`)!;
const calculation = (p: EngineeringPassport) =>
  p.calculations.find((c) => c.id === `project-energy:${demand(p).id}.0`)!;
const catalog = (p: EngineeringPassport) => p.component_bindings.map((b) => b.record);
const rehashPassport = (p: EngineeringPassport) => {
  const { passport_digest: _digest, ...body } = p;
  return {
    ...body,
    input_digest: passportDigest(p.input),
    passport_digest: passportDigest({ ...body, input_digest: passportDigest(p.input) }),
  };
};

describe('generic project demand schedule provenance', () => {
  it('late timing has independent attribution in the passport alone', () => {
    const { passport, source } = fixture();
    expect(demand(passport)).toMatchObject({
      required_power_w: 100,
      domain_id: source.selection.input.generation.candidates[0]!.demand_endpoints[0]!.domain_id,
      provenance: { requirement_id: 'load', pointer: '/requirements/loads/0' },
      schedule_provenance: { origin: 'evaluation_input' },
      schedule: [{ state: 'active', duration_hours: 1 }],
    });
    expect(Object.keys(demand(passport).provenance).sort()).toEqual(['pointer', 'requirement_id']);
    expect(demand(passport).schedule_provenance).toEqual({ origin: 'evaluation_input' });
  });
  it('decision and energy calculation retain separate timing origin and endpoint provenance', () => {
    const { passport } = fixture();
    for (const trace of [decision(passport), calculation(passport)]) {
      expect(trace.inputs).toMatchObject({
        provenance: demand(passport).provenance,
        schedule_provenance: { origin: 'evaluation_input' },
      });
      expect(trace.evidence_refs).toEqual([]);
      expect(trace.assumption_ids).toEqual([]);
    }
    expect(calculation(passport).output).toBe(100);
    expect(passport.input.assumptions).toEqual([]);
    expect(passport.examined_evidence.every((e) => e.component_id === 'fixture.a')).toBe(true);
  });
  it('identical late repetition preserves requirement-owned timing and its exact locator', () => {
    const { passport } = fixture(true);
    const expected = {
      origin: 'requirement',
      requirement_id: 'load',
      pointer: '/requirements/loads/0/schedule',
    };
    expect(demand(passport).schedule_provenance).toEqual(expected);
    expect(decision(passport).inputs).toMatchObject({ schedule_provenance: expected });
    expect(calculation(passport).inputs).toMatchObject({ schedule_provenance: expected });
  });
  it('complete accounting preserves every inherited unresolved condition', () => {
    const { source, passport, option } = fixture(true);
    expect(source.selection.input.generation.candidates[0]!.structural_evaluation.status).toBe(
      'unresolved',
    );
    expect(
      source.selection.input.generation.candidates[0]!.decisions.some(
        (d) => d.code === 'schedule_energy_unmodeled',
      ),
    ).toBe(true);
    expect(passport.result.energy.completeness).toBe('complete');
    expect(passport.result.status).toBe('unresolved');
    expect(option.engineering_status).toBe('unresolved');
    const oldCall = bindProductSelection(source.selection, option.choice.bindings, {
      evaluation_hours: 1,
      device_states: source.handoff.device_states,
    });
    expect(passport.input.requirements.mandatory_conditions).toEqual(
      oldCall.input.requirements.mandatory_conditions,
    );
  });
  it('new late accounting leaves unsupported upstream authority and genuine assumptions intact', () => {
    const { source } = fixture();
    const original = source.selection.input.generation.input;
    const assumption = {
      id: 'access',
      origin: 'project' as const,
      statement: 'Project requires access review.',
    };
    const generation = generateArchitectures({
      ...original,
      assumptions: [assumption],
      requirements: {
        ...original.requirements,
        unsupported_requirements: [
          { id: 'access', kind: 'installation', statement: 'Verify access.' },
        ],
      },
    });
    const selection = evaluateProductSelection({
      ...source.selection.input,
      generation,
      candidate_id: generation.candidates[0]!.id,
    });
    const result = evaluateRecommendation(
      recommendationRequest([{ selection, handoff: source.handoff }]),
    );
    const p = result.options[0]!.passport;
    expect(generation.candidates[0]!.demand_endpoints[0]!.schedule).toBeUndefined();
    expect(demand(p).schedule_provenance).toEqual({ origin: 'evaluation_input' });
    expect(p.result.energy.completeness).toBe('complete');
    expect(p.result.status).toBe('unresolved');
    expect(p.input.assumptions).toEqual([assumption]);
    expect(decision(p).assumption_ids).toEqual([]);
    expect(calculation(p).evidence_refs).toEqual([]);
    expect(p.input.requirements.mandatory_conditions).toContainEqual(
      expect.objectContaining({ id: 'architecture', status: 'unresolved' }),
    );
  });
  it('no late timing preserves omission and incomplete accounting in existing handoff calls', () => {
    const { source, option } = fixture();
    const bound = bindProductSelection(source.selection, option.choice.bindings);
    expect(bound.input.assumptions).toEqual([]);
    expect(bound.input.requirements.project_demands![0]!.schedule).toBeUndefined();
    expect(bound.input.requirements.project_demands![0]!.schedule_provenance).toBeUndefined();
    const p = evaluateInstalledSystem(bound.input, bound.catalog);
    expect(p.result.energy.completeness).toBe('incomplete');
    expect(p.result.energy.unresolved_contributions).toContainEqual(
      expect.objectContaining({
        kind: 'project_demand',
        reasons: expect.arrayContaining(['schedule_missing', 'horizon_unknown']),
      }),
    );
    expect(decision(p).inputs).toMatchObject({ schedule_provenance: { origin: 'unknown' } });
  });
  it('legacy Phase 3 omission stays unknown without changing valid numerical behavior', () => {
    const { passport } = fixture();
    const input = JSON.parse(serializePassportValue(passport.input));
    delete input.requirements.project_demands[0].schedule_provenance;
    const legacy = evaluateInstalledSystem(input, catalog(passport));
    expect(legacy.result).toEqual(passport.result);
    expect(demand(legacy).schedule_provenance).toBeUndefined();
    expect(decision(legacy).inputs).toMatchObject({ schedule_provenance: { origin: 'unknown' } });
    expect(calculation(legacy).inputs).toMatchObject({
      schedule_provenance: { origin: 'unknown' },
    });
    expect(parseEngineeringPassport(serializeEngineeringPassport(legacy))).toEqual(legacy);
  });
  it('a declared late state without duration stays unknown', () => {
    const { source } = fixture();
    const result = evaluateRecommendation(
      recommendationRequest([
        {
          ...source,
          handoff: {
            ...source.handoff,
            project_demand_schedules: [
              {
                demand_id: source.handoff.project_demand_schedules![0]!.demand_id,
                schedule: [{ state: 'active' }],
              },
            ],
          },
        },
      ]),
    );
    const p = result.options[0]!.passport;
    expect(demand(p).schedule_provenance).toEqual({ origin: 'evaluation_input' });
    expect(p.result.energy.completeness).toBe('incomplete');
    expect(p.result.energy.unresolved_contributions).toContainEqual(
      expect.objectContaining({
        kind: 'project_demand',
        reasons: expect.arrayContaining(['duration_unknown']),
      }),
    );
  });
  it.each(['unknown', 'duplicate', 'override'] as const)(
    '%s late schedule still rejects',
    (mode) => {
      const { source, option } = fixture(mode === 'override');
      const entry = source.handoff.project_demand_schedules![0]!;
      const schedules =
        mode === 'unknown'
          ? [{ ...entry, demand_id: 'missing' }]
          : mode === 'duplicate'
            ? [entry, entry]
            : [{ ...entry, schedule: [{ state: 'active' as const, duration_hours: 2 }] }];
      const handoff = { ...source.handoff, project_demand_schedules: schedules };
      expect(() =>
        bindProductSelection(source.selection, option.choice.bindings, handoff),
      ).toThrow();
      expect(() =>
        evaluateRecommendation(recommendationRequest([{ ...source, handoff }])),
      ).toThrow();
    },
  );
  it('upstream handoff without late timing keeps upstream ownership', () => {
    const { source, option } = fixture(true);
    const { project_demand_schedules: _late, ...handoff } = source.handoff;
    const bound = bindProductSelection(source.selection, option.choice.bindings, handoff);
    expect(bound.input).toEqual(option.passport.input);
  });
  it('truthful distinct origins participate in standalone Phase 3 identity, not engineering truth', () => {
    const { passport } = fixture();
    // Synthetic alternative project input: this requirement declares the same
    // timing upstream. Neither label authenticates an external document.
    const input = JSON.parse(serializePassportValue(passport.input));
    input.requirements.project_demands[0].schedule_provenance = {
      origin: 'requirement',
      requirement_id: 'load',
      pointer: '/requirements/loads/0/schedule',
    };
    const upstream = evaluateInstalledSystem(input, catalog(passport));
    expect(upstream.result).toEqual(passport.result);
    expect(upstream.input_digest).not.toBe(passport.input_digest);
    expect(upstream.passport_digest).not.toBe(passport.passport_digest);
    // A coherently evaluated new input is valid. A hash proves content identity,
    // and standalone replay has no external requirement-origin authentication.
    expect(parseEngineeringPassport(serializeEngineeringPassport(upstream))).toEqual(upstream);
    expect(replayEngineeringPassport(upstream, catalog(passport)).ok).toBe(true);
  });
  it.each([false, true])(
    'passport and recommendation round-trip/replay preserve upstream=%s origin',
    (upstream) => {
      const { passport, request, result } = fixture(upstream);
      expect(parseEngineeringPassport(serializeEngineeringPassport(passport))).toEqual(passport);
      expect(replayEngineeringPassport(passport, catalog(passport))).toEqual({
        ok: true,
        passport,
      });
      expect(parseRecommendation(serializeRecommendation(result))).toEqual(result);
      expect(replayRecommendation(result, request)).toEqual(result);
    },
  );
  it.each(['input', 'decision', 'calculation'] as const)(
    'Phase 3 rejects rehashed %s timing-origin tampering',
    (mode) => {
      const { passport } = fixture();
      const forged = JSON.parse(serializePassportValue(passport));
      if (mode === 'input')
        forged.input.requirements.project_demands[0].schedule_provenance = { origin: 'unknown' };
      else
        Object.assign(mode === 'decision' ? decision(forged) : calculation(forged), {
          inputs: {
            ...((mode === 'decision' ? decision(forged) : calculation(forged)).inputs as object),
            schedule_provenance: { origin: 'unknown' },
          },
        });
      const rehashed = rehashPassport(forged);
      expect(() => parseEngineeringPassport(serializePassportValue(rehashed))).toThrow(/reproduce/);
      expect(replayEngineeringPassport(rehashed, catalog(passport))).toMatchObject({
        ok: false,
        code: 'invalid_passport',
      });
    },
  );
  it.each(['input', 'decision', 'calculation', 'coherent_passport'] as const)(
    'Phase 6 rejects rehashed %s timing-origin tampering',
    (mode) => {
      const { result, request } = fixture();
      const forged = JSON.parse(serializePassportValue(result));
      const p = forged.options[0].passport;
      if (mode === 'input' || mode === 'coherent_passport')
        p.input.requirements.project_demands[0].schedule_provenance = { origin: 'unknown' };
      else
        Object.assign(mode === 'decision' ? decision(p) : calculation(p), {
          inputs: {
            ...((mode === 'decision' ? decision(p) : calculation(p)).inputs as object),
            schedule_provenance: { origin: 'unknown' },
          },
        });
      forged.options[0].passport =
        mode === 'coherent_passport'
          ? evaluateInstalledSystem(p.input, catalog(p))
          : rehashPassport(p);
      const { option_digest: _option, ...optionBody } = forged.options[0];
      forged.options[0].option_digest = passportDigest(optionBody);
      const { result_digest: _digest, ...body } = forged;
      forged.result_digest = passportDigest(body);
      expect(() => parseRecommendation(serializePassportValue(forged))).toThrow(/reproduce/);
      expect(() => replayRecommendation(forged, request)).toThrow(/reproduce/);
    },
  );
  it('external recommendation replay rejects changed authoritative timing input', () => {
    const { result, request } = fixture();
    const input = JSON.parse(serializePassportValue(request));
    delete input.sources[0].handoff.project_demand_schedules;
    const changed = evaluateRecommendation(input);
    expect(changed.result_digest).not.toBe(result.result_digest);
    expect(() => replayRecommendation(changed, request)).toThrow(/changed/);
  });
  it('explicit unknown origin is valid and supplies no requirement citation', () => {
    const { passport } = fixture();
    const input = JSON.parse(serializePassportValue(passport.input));
    input.requirements.project_demands[0].schedule_provenance = { origin: 'unknown' };
    const p = evaluateInstalledSystem(input, catalog(passport));
    expect(p.result).toEqual(passport.result);
    expect(calculation(p).inputs).toMatchObject({ schedule_provenance: { origin: 'unknown' } });
  });
  it('attribution alone cannot supply a missing schedule', () => {
    const { passport } = fixture();
    const input = JSON.parse(serializePassportValue(passport.input));
    delete input.requirements.project_demands[0].schedule;
    expect(() => evaluateInstalledSystem(input, catalog(passport))).toThrow(/schema/);
  });
  it('current reconstruction does not silently replay older trace revisions', () => {
    const { passport } = fixture();
    const forged = { ...passport, evaluator_revision: 'installed-system-proof/1.2.0' };
    expect(() => parseEngineeringPassport(serializePassportValue(rehashPassport(forged)))).toThrow(
      /revision/,
    );
    expect(replayEngineeringPassport(forged, catalog(passport))).toMatchObject({
      ok: false,
      code: 'evaluator_changed',
    });
    expect(passport.evaluator_revision).toBe('installed-system-proof/1.3.0');
    expect(passport.rule_data.version).toBe('1.3.0');
  });
  it.each([
    { origin: 'requirement' },
    { origin: 'evaluation_input', pointer: '/invented-document' },
    { origin: 'manufacturer' },
  ])('closed schema rejects invalid timing attribution %j', (provenance) => {
    const { passport } = fixture();
    const input = JSON.parse(serializePassportValue(passport.input));
    input.requirements.project_demands[0].schedule_provenance = provenance;
    expect(() => evaluateInstalledSystem(input, catalog(passport))).toThrow(/schema/);
  });
});
