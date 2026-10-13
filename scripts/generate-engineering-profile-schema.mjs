import { readFileSync, writeFileSync } from 'node:fs';

// One definition generates both the portable profile and its inline canonical
// copy. Inline inclusion keeps historical standalone AJV consumers portable;
// --check detects drift without traversing any component corpus.
const text = { type: 'string', minLength: 1 };
const ids = { type: 'array', minItems: 1, uniqueItems: true, items: text };
const obj = (properties, required = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const evidence = { evidence_ids: ids };
const fact = (unit, minimum) =>
  obj(
    {
      value: { type: 'number', ...(minimum === undefined ? {} : { minimum }) },
      unit: { const: unit },
      ...evidence,
    },
    ['value', 'unit', 'evidence_ids'],
  );
const range = obj({ min: { type: 'number' }, max: { type: 'number' } }, ['min', 'max']);
const positive = { type: 'integer', minimum: 1 };
const coeff = (units) =>
  obj(
    {
      value: { type: 'number' },
      unit: { enum: units },
      cell_domain_c: range,
      ...evidence,
    },
    ['value', 'unit', 'evidence_ids'],
  );
const pv = obj({
  voc_v: fact('V', 0),
  vmp_v: fact('V', 0),
  isc_a: fact('A', 0),
  imp_a: fact('A', 0),
  pmax_w: fact('W', 0),
  reference_cell_c: fact('degC'),
  irradiance_w_m2: fact('W/m2', 0),
  spectrum: obj({ value: text, ...evidence }, ['value', 'evidence_ids']),
  coefficients: obj({
    voc: coeff(['percent/K', 'fraction/K', 'V/K']),
    vmp: coeff(['percent/K', 'fraction/K', 'V/K']),
    isc: coeff(['percent/K', 'fraction/K', 'A/K']),
    imp: coeff(['percent/K', 'fraction/K', 'A/K']),
    pmax: coeff(['percent/K', 'fraction/K', 'W/K']),
  }),
  uncertainty_fraction: obj({
    voc: fact('fraction', 0),
    vmp: fact('fraction', 0),
    isc: fact('fraction', 0),
    imp: fact('fraction', 0),
    pmax: fact('fraction', 0),
  }),
  max_system_v: fact('V', 0),
  max_series_fuse_a: fact('A', 0),
});
const tracker = obj(
  {
    id: text,
    terminal_ids: ids,
    grouping_status: { enum: ['source_supported', 'unresolved'] },
    ...evidence,
    input_sharing: { enum: ['permitted', 'prohibited'] },
    absolute_voc_v: fact('V', 0),
    operating_max_v: fact('V', 0),
    operating_max_basis: { enum: ['voc_envelope', 'vmp_envelope', 'source_defined_unmodeled'] },
    operating_min_v: fact('V', 0),
    start_headroom_v: fact('V', 0),
    run_headroom_v: fact('V', 0),
    restart_headroom_v: fact('V', 0),
    max_isc_a: fact('A', 0),
    max_imp_a: fact('A', 0),
    terminal_limits: {
      type: 'array',
      items: obj({ id: text, max_isc_a: fact('A', 0), max_imp_a: fact('A', 0) }, ['id']),
    },
    power_limits: {
      type: 'array',
      items: obj(
        {
          battery_nominal_v: fact('V', 0),
          max_pmax_w: fact('W', 0),
          clipping: { enum: ['permitted', 'prohibited'] },
          ...evidence,
        },
        ['battery_nominal_v', 'max_pmax_w', 'clipping', 'evidence_ids'],
      ),
    },
  },
  ['id', 'grouping_status', 'evidence_ids'],
);
const capacity = obj(
  {
    id: text,
    mode: text,
    path_ids: ids,
    unit: { enum: ['W', 'VA', 'A'] },
    limit: { type: 'number', minimum: 0 },
    ...evidence,
    battery_count: positive,
    temperature_c: range,
    unresolved_conditions: ids,
    excluded_path_pairs: {
      type: 'array',
      items: { type: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: text },
    },
    accounting: { const: 'boundary_demand_includes_losses' },
  },
  ['id', 'mode', 'path_ids', 'unit', 'limit', 'evidence_ids', 'accounting'],
);
const acMode = obj(
  {
    id: text,
    kind: { enum: ['inversion', 'bypass'] },
    ...evidence,
    relationship: { enum: ['single_phase', 'split_phase', 'same_phase_legs'] },
    line_neutral_v: fact('V', 0),
    line_line_v: fact('V', 0),
    source_required: { type: 'boolean' },
    leg_limits_a: obj({ L1: fact('A', 0), L2: fact('A', 0) }),
    neutral_limit_a: fact('A', 0),
    neutral_evidence_ids: ids,
    grounding_evidence_ids: ids,
  },
  ['id', 'kind', 'evidence_ids'],
);
const assembly = obj(
  {
    component_id: text,
    model: text,
    compatible_revision: { type: ['string', 'null'], minLength: 1 },
    relationship: { enum: ['required', 'included', 'optional'] },
    min_count: { type: 'integer', minimum: 0 },
    max_count: positive,
    modes: ids,
    protocol: text,
    ...evidence,
  },
  [
    'component_id',
    'model',
    'compatible_revision',
    'relationship',
    'min_count',
    'max_count',
    'evidence_ids',
  ],
);
const profile = obj(
  {
    schema_version: { const: 'engineering-profile.v1' },
    component_id: text,
    model: text,
    manufacturer_revision: { type: ['string', 'null'], minLength: 1 },
    evidence: {
      type: 'array',
      items: obj(
        {
          id: text,
          source_url: text,
          publisher: text,
          model: text,
          manufacturer_revision: { type: ['string', 'null'], minLength: 1 },
          retrieved_at: { type: 'string', format: 'date-time' },
          locator: text,
          source_digest: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
          statement: text,
          conditions: { type: 'array', items: text },
          origin: { enum: ['source_stated', 'synthetic'] },
          rights: { enum: ['metadata_and_limited_facts_only', 'project_authored'] },
          human_interpretation: obj(
            {
              version: { const: 'engineering-profile-adjudication.v1' },
              event_id: text,
              fact_id: text,
              source_document_revision: { type: ['string', 'null'] },
              source_unit: text,
            },
            ['version', 'event_id', 'fact_id', 'source_document_revision', 'source_unit'],
          ),
        },
        [
          'id',
          'source_url',
          'publisher',
          'model',
          'manufacturer_revision',
          'retrieved_at',
          'locator',
          'source_digest',
          'statement',
          'conditions',
          'origin',
          'rights',
        ],
      ),
    },
    pv,
    trackers: { type: 'array', items: tracker },
    shared_capacity: { type: 'array', items: capacity },
    shared_capacity_inventory: {
      type: 'array',
      items: obj({ mode: text, group_ids: ids, ...evidence }, [
        'mode',
        'group_ids',
        'evidence_ids',
      ]),
    },
    ac_modes: { type: 'array', items: acMode },
    assembly: { type: 'array', items: assembly },
  },
  ['schema_version', 'component_id', 'model', 'manufacturer_revision', 'evidence'],
);
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:expedition:engineering-profile:v1',
  title: 'Evidence-bound engineering preparation profile v1',
  ...profile,
};
const componentPath = 'data/schemas/component.schema.json';
const componentText = readFileSync(componentPath, 'utf8').replaceAll('\r\n', '\n');
const canonicalProfile = {
  ...profile,
  description:
    'Versioned source facts for explicit PV, shared-capacity, AC-mode and assembly consumers. Missing members remain unknown. Presence grants no review or verification authority. Historical records are not migrated.',
};
// Preserve every unrelated canonical schema byte. This owned property is last
// in the root properties object; do not broadly reformat historical contracts.
const closing = componentText.indexOf('\n  },\n  "additionalProperties":');
if (closing < 0)
  throw new Error('Canonical properties boundary changed; inspect before generation');
const existing = componentText.indexOf('    "engineering_profile":');
const prefix = componentText
  .slice(0, existing >= 0 ? existing : closing)
  .trimEnd()
  .replace(/,$/, '');
const { format, resolveConfig } = await import('prettier');
const options = { ...(await resolveConfig(componentPath)), parser: 'json' };
const formatted = (await format(JSON.stringify(canonicalProfile, null, 2), options)).trimEnd();
const inline = formatted
  .split('\n')
  .map((line, i) => (i ? '    ' + line : line))
  .join('\n');
const componentBytes =
  prefix + ',\n    "engineering_profile": ' + inline + componentText.slice(closing);
for (const [path, bytes] of [
  [
    'data/schemas/engineering-profile.schema.json',
    await format(JSON.stringify(schema, null, 2), options),
  ],
  [componentPath, componentBytes],
]) {
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') !== bytes)
      throw new Error(`Engineering schema drift: ${path}`);
  } else writeFileSync(path, bytes);
}
