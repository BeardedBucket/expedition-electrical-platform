import { it, expect, describe } from 'vitest';
import { nativeModelGridObservations } from '../src/native-model-grid.js';
const bytes = (s: string) => new TextEncoder().encode(s);
const table = () =>
  '<table><thead><tr><th></th><th>SC-A</th><th>SC-B</th></tr></thead><tbody><tr><td>PV Isc</td><td>35A</td><td>45A</td></tr><tr><td>PV Voc</td><td colspan="2">150V</td></tr><tr><td colspan="3">Conditional table footnote</td></tr></tbody></table>';
describe('Native explicit model grid isolated authoring experiment', () => {
  it('preserves exact sibling column and source-declared shared span without engineering approval', () => {
    const a = nativeModelGridObservations(bytes(table()), 'SC-A');
    const b = nativeModelGridObservations(bytes(table()), 'SC-B');
    expect(a.map((x) => x.value)).toEqual(['35A', '150V']);
    expect(b.map((x) => x.value)).toEqual(['45A', '150V']);
    expect(b[1]!.source_literal).toBe('<td colspan="2">150V</td>');
    expect(b.every((x) => x.source_conditions.length > 0)).toBe(true);
  });
  it.each(['unknown', 'duplicate', 'ragged', 'rowspan', 'nested', 'repeat', 'malformedSpan'])(
    'rejects the complete source region for %s',
    (kind) => {
      let t = table(),
        model = 'SC-A';
      if (kind === 'unknown') model = 'SC-C';
      if (kind === 'duplicate') t += t;
      if (kind === 'ragged') t = t.replace('<td>45A</td>', '');
      if (kind === 'rowspan') t = t.replace('<td>35A</td>', '<td rowspan="2">35A</td>');
      if (kind === 'nested') t = t.replace('35A', '<table><tr><th>X</th><th>Y</th></tr></table>');
      if (kind === 'repeat') t = t.replace('PV Isc', 'Model');
      if (kind === 'malformedSpan') t = t.replace('colspan="2"', 'colspan="bogus"');
      expect(() => nativeModelGridObservations(bytes(t), model)).toThrow();
    },
  );
});
