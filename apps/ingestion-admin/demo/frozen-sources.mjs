import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Exact frozen observation identities, not oracle/adjudication output. Manufacturer text is
// injected into a fresh local TEMP build only; restricted datasheets are never copied into Git.
const sources = [
  {
    key: 'victron-bmv-712',
    maker: 'Victron Energy',
    model: 'BMV-712 Smart',
    hash: 'b09ef2001d990e09edea6d2f4655c09870b2c6f98be9cdcb951f88a7339adcde',
    pdf: '571accecb558bf454f11981ba6fc2e5cc138b9dbebe1c0e121f1a0d3b942de98',
    rows: [/^Accuracy of current measurement/, /^Current ±/, /^Current draw, back light off/],
    context: [/^Battery Monitor/, /^RESOLUTION & ACCURACY/],
  },
  {
    key: 'morningstar-sunsaver-10l',
    maker: 'Morningstar',
    model: 'SS-10L-12V',
    hash: '0a4060d282abcba7bc988b5bb438215d8164916ef4f3117692f7d57b535b7b70',
    pdf: '23b826c9274b1b7d737de7bbbe3f0cbe92997f2bfedc131ebdfc25917ed243e1',
    rows: [/^Sealed battery/, /^Max\. solar voltage 30V/, /^Self-consumption/],
    context: [/^Versions/, /^SS-10-12V/, /^Regulation voltage/],
  },
  {
    key: 'samlex-evo-2212',
    maker: 'Samlex America',
    model: 'EVO-2212',
    hash: 'c438b4815d3dcc982cee83ea09de98ad161a5c40e4d835b1fd5fd4844a55fda3',
    pdf: '71e314a57ad30e32cecb8a0926b9c5893837587ec1f1cb7ce1ef3dee2d87f02b',
    rows: [
      /^CONTINUOUS AC OUTPUT CURRENT/,
      /^MAXIMUM CONTINUOUS DC INPUT CURRENT/,
      /^PROGRAMMABLE CHARGING CURRENT AND VOLTAGE/,
    ],
    context: [/^INVERTER EVO-2212/, /^\(3\) Specifications/],
  },
];
export function loadFrozenSourceScenarios(directory) {
  const root = fs.realpathSync(directory);
  if (path.basename(root) !== 'expedition-document-extraction-benchmark')
    throw new Error('Use the authorized frozen benchmark directory only.');
  const exactFile = (relative) => {
    const resolved = fs.realpathSync(path.join(root, relative));
    if (!resolved.startsWith(root + path.sep))
      throw new Error('Frozen observation escapes its authorized directory.');
    return resolved;
  };
  const manifest = JSON.parse(fs.readFileSync(exactFile('artifact-manifest.json'), 'utf8'));
  return sources.map((source) => {
    const relative = path.join('outputs', 'pdfplumber-text', source.key + '.json');
    const bytes = fs.readFileSync(exactFile(relative));
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const entry = manifest.find((item) =>
      item.path.replaceAll('\\', '/').endsWith('/' + relative.replaceAll('\\', '/')),
    );
    if (digest !== source.hash || entry?.sha256 !== digest)
      throw new Error('Frozen observation identity changed: ' + source.key);
    const observation = JSON.parse(bytes.toString('utf8'));
    if (
      observation.source.key !== source.key ||
      observation.source.sha256 !== source.pdf ||
      observation.page !== 2 ||
      !/^https:\/\//.test(observation.source.source_uri)
    )
      throw new Error('Frozen source metadata mismatch: ' + source.key);
    const lines = observation.text.split('\n');
    const context = source.context
      .map((pattern) => lines.find((line) => pattern.test(line)))
      .filter(Boolean);
    const items = source.rows.map((pattern) => {
      const index = lines.findIndex((line) => pattern.test(line));
      if (index < 0) throw new Error('Expected source observation absent: ' + source.key);
      const id = 'retained-observation.' + digest + '.line-' + (index + 1);
      return {
        id,
        automatic_target: 'source_observation:' + index,
        automatic_disposition: 'unsupported',
        derived: false,
        state: 'automatic',
        required: true,
        decision_history: [],
        evidence: [
          {
            id: id + '.statement',
            label: lines[index],
            raw_value: lines[index],
            // No table-column/model binding, source units, capture artifact reference or
            // qualification is manufactured from flattened text. Explicit review stays unresolved.
            applicability: { kind: 'unknown' },
            conflicts: [],
            document: source.model + ' · frozen pdfplumber text observation',
            source_uri: observation.source.source_uri,
            locators: [
              {
                role: 'value',
                text: lines[index],
                block_id: 'extraction-text-line-' + (index + 1),
                locator: { kind: 'pdf', page: observation.page },
              },
              ...context.map((text) => ({
                role: 'context',
                text,
                locator: { kind: 'pdf', page: observation.page },
              })),
            ],
            source_context: {
              wording: lines[index],

              content_digest: 'sha256:' + source.pdf,
              content_digest_algorithm: 'sha256',
              retrieved_at: observation.source.retrieved_at,
            },
          },
        ],
      };
    });
    return {
      id: 'retained-' + source.key,
      title: 'Retained source · ' + source.model,
      risk: 'Genuine frozen manufacturer text; assembled isolated review DTO. Model/table qualification is unproven. Eligibility is scripted empty and saves are memory only; this is not tested backend discovery for these observations.',
      items,
      targets: [],
      identity: { manufacturer: source.maker, product_model: source.model },
      retainedSource: {
        observation_digest: 'sha256:' + digest,
        pdf_digest: 'sha256:' + source.pdf,
        uri: observation.source.source_uri,
        page: observation.page,
        engine: observation.engine,
        version: observation.version,
      },
    };
  });
}
