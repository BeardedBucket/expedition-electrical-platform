import { readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';

// Closed authoring contract. These are proposed source meanings, never a human
// decision or canonical component. Strings preserve unsupported facts rather
// than forcing them into a numeric rating with a different electrical meaning.
const text = { type: 'string', minLength: 1 };
const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const range = obj({ min: { type: 'number' }, max: { type: 'number' } });
const value = {
  anyOf: [
    { type: 'number' },
    text,
    { type: 'boolean' },
    range,
    obj({ x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }),
  ],
};
const strings = { type: 'array', items: text };
const hash = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };
const nullable = { type: ['string', 'null'] };
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:expedition:source-grounded-draft:v1',
  ...obj(
    {
      version: { const: 'source-grounded-draft.v1' },
      authority: { const: 'codex_prepared_unreviewed' },
      product: obj({
        id: text,
        manufacturer: text,
        model: text,
        manufacturer_part_number: nullable,
        hardware_revision: nullable,
      }),
      intended_use: text,
      sources: {
        type: 'array',
        minItems: 1,
        items: obj({
          id: text,
          url: text,
          publisher: text,
          retrieved_at: text,
          content_digest: hash,
          document_revision: nullable,
          model: text,
          identity_locator: text,
          rights: { const: 'metadata_and_limited_facts_only' },
          redistribution_grant: { const: 'not_established' },
        }),
      },
      facts: {
        type: 'array',
        minItems: 1,
        items: obj({
          id: text,
          quantity: text,
          basis: {
            enum: [
              'nominal',
              'absolute',
              'operating',
              'continuous',
              'peak',
              'typical',
              'recommended',
              'measurement',
              'body',
              'installation',
              'descriptive',
              'protection',
            ],
          },
          mode: text,
          direction: { enum: ['input', 'output', 'bidirectional', 'none', 'unknown'] },
          electrical_domain: { enum: ['dc', 'ac', 'none', 'unknown'] },
          original: obj({
            value: text,
            unit: text,
            presentation: {
              enum: ['source_literal', 'source_value_reconstruction', 'authored_summary'],
            },
          }),
          normalized: obj({ value, unit: text }),
          normalization: {
            enum: [
              'identity',
              'symmetric_range',
              'cm_to_mm',
              'kvdc_to_vdc',
              'in_to_mm',
              'lb_to_kg',
              'kwh_to_wh',
              'ma_to_a',
              'percent_to_fraction',
              'minutes_to_seconds',
            ],
          },
          source_id: text,
          locator: text,
          context_digest: hash,
          conditions: { type: 'array', items: obj({ key: text, value, unit: text }) },
          unresolved_conditions: strings,
          disposition: { enum: ['typed_consumer', 'retained_source_fact', 'evidence_ambiguity'] },
        }),
      },
      holds: strings,
      ports: {
        type: 'array',
        minItems: 1,
        items: obj({
          id: text,
          label: text,
          domain: { enum: ['dc', 'ac'] },
          direction: { enum: ['input', 'output', 'bidirectional'] },
          voltage_v: { anyOf: [{ type: 'number' }, range] },
          source_fact_ids: strings,
        }),
      },
      power_paths: {
        type: 'array',
        minItems: 1,
        items: obj({ id: text, from_port: text, to_port: text, source_fact_ids: strings }),
      },
    },
    ['version', 'authority', 'product', 'intended_use', 'sources', 'facts', 'holds'],
  ),
};
const pvArray = obj(
  {
    controller_instance_id: text,
    strings: {
      type: 'array',
      minItems: 1,
      items: obj({
        series_count: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        module_instance_ids: { anyOf: [{ type: 'null' }, { type: 'array', items: text }] },
      }),
    },
    module_temperature_c: { type: ['number', 'null'] },
    irradiance_w_m2: { type: ['number', 'null'] },
    spectrum: { type: ['string', 'null'] },
    tracker_id: { type: ['string', 'null'] },
    battery_voltage_v: { type: ['number', 'null'], exclusiveMinimum: 0 },
    controller_state: { enum: ['startup', 'running', null] },
  },
  [
    'controller_instance_id',
    'strings',
    'module_temperature_c',
    'irradiance_w_m2',
    'spectrum',
    'tracker_id',
  ],
);
const scenario = {
  $schema: schema.$schema,
  $id: 'urn:expedition:installed-source-draft-scenario:v1',
  ...obj(
    {
      version: { const: 'installed-source-draft-scenario.v1' },
      uses: {
        type: 'array',
        items: obj({
          instance_id: text,
          requirements: {
            type: 'array',
            minItems: 1,
            items: obj({
              quantity: text,
              mode: text,
              direction: { enum: ['input', 'output', 'bidirectional', 'none', 'unknown'] },
              electrical_domain: { enum: ['dc', 'ac', 'none', 'unknown'] },
              unit: text,
              value: { anyOf: [{ type: 'number' }, text] },
              predicate: { enum: ['within_range', 'at_most', 'at_least', 'equals'] },
              conditions: {
                type: 'array',
                items: obj({
                  key: text,
                  value: { anyOf: [{ type: 'number' }, text, { type: 'boolean' }] },
                  unit: text,
                }),
              },
            }),
          },
        }),
      },
      pv_arrays: { type: 'array', minItems: 1, items: pvArray },
    },
    ['version', 'uses'],
  ),
};
for (const [path, definition] of [
  ['data/schemas/source-grounded-draft.schema.json', schema],
  ['data/schemas/installed-source-draft-scenario.schema.json', scenario],
]) {
  const bytes = await format(JSON.stringify(definition), {
    ...(await resolveConfig(path)),
    parser: 'json',
  });
  if (process.argv.includes('--check')) {
    if ((await readFile(path, 'utf8')).replaceAll('\r\n', '\n') !== bytes)
      throw Error('Source draft schema drift: ' + path);
  } else await writeFile(path, bytes);
}
