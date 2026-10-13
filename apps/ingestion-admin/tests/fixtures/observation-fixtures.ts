import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface ObservationCase {
  key: string;
  model: string;
  hash: string;
  genuine: boolean;
  range?: { wording: string; value: string; min: number; max: number };
  precision?: { wording: string; value: string };
  source?: { sha256: string; uri: string; retrieved_at: string };
}

export const projectObservations: readonly ObservationCase[] = [
  {
    key: 'monitor',
    model: 'Review Monitor R1',
    genuine: false,
    hash: 'd8866c26fed9b0a2046ec07e85e151215e8d31396a2ab98e69a5a238a16439f5',
    range: {
      wording: 'Supply voltage range 7.25 - 68 VDC',
      value: '7.25 - 68 VDC',
      min: 7.25,
      max: 68,
    },
    precision: { wording: 'Accuracy of current measurement ± 0.6 %', value: '± 0.6 %' },
  },
  {
    key: 'controller',
    model: 'SC-11',
    genuine: false,
    hash: 'f5a68cc7056a0e089377edb5f235472dc5a9c29d4f692673bca5a2fe07174950',
  },
  {
    key: 'inverter',
    model: 'Review Inverter IC-21',
    genuine: false,
    hash: '1ba173d309c5d7225bc9772ad43933c87f76f7be73bdc63285fc38583a856273',
  },
];

// Exact observation/PDF identities from the previously authorized frozen
// inventory. They identify private artifacts, never permission to redistribute
// page text, nor authority to follow embedded PDF/capture/baseline paths.
export const genuineObservations: readonly ObservationCase[] = [
  {
    key: 'victron-bmv-712',
    model: 'BMV-712 Smart',
    genuine: true,
    hash: 'b09ef2001d990e09edea6d2f4655c09870b2c6f98be9cdcb951f88a7339adcde',
    range: {
      wording: 'Supply voltage range 6.5 - 70 VDC',
      value: '6.5 - 70 VDC',
      min: 6.5,
      max: 70,
    },
    precision: { wording: 'Accuracy of current measurement ± 0.4 %', value: '± 0.4 %' },
    source: {
      sha256: '571accecb558bf454f11981ba6fc2e5cc138b9dbebe1c0e121f1a0d3b942de98',
      uri: 'https://www.victronenergy.com/upload/documents/Datasheet-BMV-712-Smart-EN.pdf',
      retrieved_at: '2026-10-05T22:55:39.079Z',
    },
  },
  {
    key: 'morningstar-sunsaver-10l',
    model: 'SS-10L-12V',
    genuine: true,
    hash: '0a4060d282abcba7bc988b5bb438215d8164916ef4f3117692f7d57b535b7b70',
    source: {
      sha256: '23b826c9274b1b7d737de7bbbe3f0cbe92997f2bfedc131ebdfc25917ed243e1',
      uri: 'https://www.morningstarcorp.com/wp-content/uploads/datasheet-sunsaver-en.pdf',
      retrieved_at: '2026-10-05T22:55:05.334Z',
    },
  },
  {
    key: 'samlex-evo-2212',
    model: 'EVO-2212',
    genuine: true,
    hash: 'c438b4815d3dcc982cee83ea09de98ad161a5c40e4d835b1fd5fd4844a55fda3',
    source: {
      sha256: '71e314a57ad30e32cecb8a0926b9c5893837587ec1f1cb7ce1ef3dee2d87f02b',
      uri: 'https://samlexamerica.com/wp-content/uploads/2021/11/Samlex-EVO-Features-Spec-Sheet-1121.pdf',
      retrieved_at: '2026-10-05T22:54:54.802Z',
    },
  },
];

export function genuineObservationRoot(): string {
  const configured = process.env.EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY;
  if (!configured)
    throw new Error(
      'Genuine observations require EXPEDITION_GENUINE_OBSERVATIONS_DIRECTORY; see tests/fixtures/observations/README.md. No TEMP fallback is used.',
    );
  const root = resolve(configured);
  if (
    root.split(/[\\/]/).includes('.local-corpus-draft-archive') ||
    root.includes('victron-energy.ekrano-gx-bpp900480100.yaml')
  )
    throw new Error('Prohibited genuine observation directory');
  return root;
}

export function validateObservationBytes(bytes: Buffer, spec: ObservationCase) {
  if (createHash('sha256').update(bytes).digest('hex') !== spec.hash)
    throw new Error('Frozen observation identity changed: ' + spec.key);
  const observation = JSON.parse(bytes.toString('utf8'));
  if (observation.page !== 2 || typeof observation.text !== 'string' || !observation.text.trim())
    throw new Error('Invalid observation payload: ' + spec.key);
  if (spec.genuine) {
    if (
      observation.source?.key !== spec.key ||
      observation.source?.sha256 !== spec.source!.sha256 ||
      observation.source?.source_uri !== spec.source!.uri ||
      observation.source?.retrieved_at !== spec.source!.retrieved_at ||
      observation.version !== '0.11.10'
    )
      throw new Error('Frozen source metadata mismatch: ' + spec.key);
  } else if (
    observation.fixture_kind !== 'project_authored' ||
    observation.license !== 'CC-BY-SA-4.0' ||
    observation.version !== 'project-observation.v1'
  )
    throw new Error('Invalid project observation provenance: ' + spec.key);
  return observation as { text: string; page: number; version: string };
}

export async function loadObservation(spec: ObservationCase) {
  const path = spec.genuine
    ? join(genuineObservationRoot(), 'outputs', 'pdfplumber-text', `${spec.key}.json`)
    : new URL(`./observations/v1/${spec.key}.json`, import.meta.url);
  if (spec.genuine) {
    const root = await realpath(genuineObservationRoot());
    const resolved = await realpath(path);
    const inside = relative(root, resolved);
    if (isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep))
      throw new Error('Frozen observation escapes configured directory');
  }
  const bytes = await readFile(path);
  return { path, bytes, observation: validateObservationBytes(bytes, spec) };
}
