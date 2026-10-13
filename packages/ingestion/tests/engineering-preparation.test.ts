import { it, expect, describe } from 'vitest';
import { prepareNativePvReference } from '../src/pv-reference-preparation.js';
import { replayEngineeringPreparation } from '../src/engineering-preparation.js';

const html = (model = 'Synthetic PV-21', extra = '') => `<html><body><div><ul>
<li>Product Code ${model}</li><li>Maximum Power (Pmax) 200W</li><li>Voltage at Pmax (Vmp) 20.74V</li>
<li>Current at Pmax (Imp) 9.68A</li><li>Open-Circuit Voltage (Voc) 24.34V</li><li>Short-Circuit Current (Isc) 10.31A</li>
</ul><ul><li>Temp. Coeff. of Voc -0.36%/K</li><li>Operating Temperature -40°C to 85°C</li>${extra}</ul></div></body></html>`;
const source = (body = html()) => ({
  source_url: 'https://synthetic.example.invalid/pv',
  publisher: 'Invented test publisher',
  retrieved_at: '2026-01-01T00:00:00Z',
  manufacturer_revision: null,
  bytes: new TextEncoder().encode(body),
});
const prepare = (body = html()) =>
  prepareNativePvReference({
    source: source(body),
    exact_model: 'Synthetic PV-21',
    component_id: 'synthetic.pv',
    required_assertions: ['exact_identity', 'reference_conditions', 'temperature_coefficients'],
  });

describe('Native PV authoring and immutable private replay', () => {
  it('prepares source-bound numeric facts with original signed units and no human authority', () => {
    const p = prepare();
    expect(p.authority).toBe('agent_proposed_not_admitted');
    expect(p.profile.pv!.voc_v!.value).toBe(24.34);
    expect(p.profile.pv!.coefficients!.voc!.unit).toBe('percent/K');
    expect(p.profile.pv!.coefficients!.voc!.cell_domain_c).toBeUndefined();
    expect(p.profile.pv!.reference_cell_c).toBeUndefined();
    expect(p.review_queue.length).toBe(6);
    expect(p.unresolved.some((s) => s.startsWith('source_interpretation_review:'))).toBe(true);
    expect(replayEngineeringPreparation(JSON.parse(JSON.stringify(p)), [source()])).toEqual(p);
  });
  it('rejects sibling/duplicate model ownership and competing values', () => {
    expect(() => prepare(html('Sibling PV-22'))).toThrow('exact Product Code');
    expect(() => prepare(html() + html())).toThrow('Unique');
    expect(() =>
      prepare(html('Synthetic PV-21', '<li>Open-Circuit Voltage (Voc) 48V</li>')),
    ).toThrow('Competing');
  });
  it('withholds unsupported numeric units and never borrows adjacent rows', () => {
    const p = prepare(html().replace('20.74V', '20.74'));
    expect(p.profile.pv!.vmp_v).toBeUndefined();
    expect(p.profile.pv!.imp_a!.value).toBe(9.68);
  });
  it('rejects competing non-list structure instead of assigning source scope', () => {
    expect(() =>
      prepare(html().replace('</ul><ul>', '</ul><p>Different SKU specifications</p><ul>')),
    ).toThrow('competing');
  });
  it('fails visibly on missing/corrupt retained bytes, metadata, offsets and changed output', () => {
    const p = prepare();
    expect(() => replayEngineeringPreparation(p, [])).toThrow('retained source');
    expect(() => replayEngineeringPreparation(p, [source(html() + ' ')])).toThrow(
      'retained source',
    );
    expect(() => replayEngineeringPreparation(p, [{ ...source(), publisher: 'Other' }])).toThrow(
      'retained source',
    );
    const shifted = structuredClone(p);
    shifted.bindings[0]!.start_byte++;
    expect(() => replayEngineeringPreparation(shifted, [source()])).toThrow('mismatch');
    const changed = structuredClone(p);
    changed.profile.pv!.voc_v!.value = 50;
    expect(() => replayEngineeringPreparation(changed, [source()])).toThrow('replay');
  });
  it('refuses unsupported cross-version upgrades and forged admission', () => {
    const p = prepare();
    expect(() =>
      replayEngineeringPreparation({ ...p, schema_version: 'engineering-preparation.v2' }, [
        source(),
      ]),
    ).toThrow('version');
    expect(() =>
      replayEngineeringPreparation({ ...p, authority: 'human_approved' }, [source()]),
    ).toThrow('replay');
  });
});
