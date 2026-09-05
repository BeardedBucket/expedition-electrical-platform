import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { validateDataRoot } from '../../../scripts/validate-data.mjs';

const repoRoot = resolve(process.cwd());
const schemaText = await readFile(
  join(repoRoot, 'data', 'schemas', 'component.schema.json'),
  'utf8',
);
const realVictronComponent = await readFile(
  join(repoRoot, 'data', 'components', 'victron-energy.pmp242200100.yaml'),
  'utf8',
);

const component = (overrides: Record<string, unknown> = {}) => ({
  id: 'acme.example-01',
  manufacturer: 'Acme',
  model: 'Example Model',
  category: 'battery',
  verification_status: 'unverified',
  ...overrides,
});

const makeRoot = async (...entries: Array<{ file: string; record: Record<string, unknown> }>) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'catalog-validation-'));
  const dataRoot = join(tempRoot, 'data');
  await mkdir(join(dataRoot, 'schemas'), { recursive: true });
  await mkdir(join(dataRoot, 'components'), { recursive: true });
  await writeFile(join(dataRoot, 'schemas', 'component.schema.json'), schemaText, 'utf8');
  for (const entry of entries) {
    const layerPath = join(dataRoot, 'components', entry.file);
    await mkdir(dirname(layerPath), { recursive: true });
    await writeFile(layerPath, stringifyYaml(entry.record), 'utf8');
  }
  return dataRoot;
};

describe('canonical catalog validation', () => {
  it('accepts a valid canonical component', async () => {
    const root = await makeRoot({ file: 'acme.example-01.yaml', record: component() });
    await expect(validateDataRoot(root)).resolves.toMatchObject({ validated: 1 });
  });

  it('rejects malformed canonical components', async () => {
    const root = await makeRoot({
      file: 'acme.example-01.yaml',
      record: component({ category: undefined }),
    });
    await expect(validateDataRoot(root)).rejects.toThrow(/failed validation/i);
  });

  it.each(['.yml', '.json'])('rejects %s canonical component extensions', async (extension) => {
    const root = await makeRoot({ file: `acme.example-01${extension}`, record: component() });
    await expect(validateDataRoot(root)).rejects.toThrow(
      new RegExp(
        `unsupported extension '${extension}' for canonical components; expected \\.yaml`,
        'i',
      ),
    );
  });

  it('rejects duplicate canonical ids', async () => {
    const root = await makeRoot(
      { file: 'first/alpha.id.yaml', record: component({ id: 'alpha.id' }) },
      { file: 'second/alpha.id.yaml', record: component({ id: 'alpha.id' }) },
    );
    await expect(validateDataRoot(root)).rejects.toThrow(
      /Duplicate canonical component ID 'alpha.id'/i,
    );
  });

  it('rejects duplicate manufacturer and part_number collisions', async () => {
    const root = await makeRoot(
      { file: 'alpha.one.yaml', record: component({ id: 'alpha.one', part_number: 'ABC-001' }) },
      { file: 'beta.two.yaml', record: component({ id: 'beta.two', part_number: 'ABC-001' }) },
    );
    await expect(validateDataRoot(root)).rejects.toThrow(
      /Duplicate canonical manufacturer \+ part number/i,
    );
  });

  it('normalizes surrounding whitespace for manufacturer and part number collisions', async () => {
    const root = await makeRoot(
      {
        file: 'alpha.one.yaml',
        record: component({ id: 'alpha.one', manufacturer: ' Acme ', part_number: ' ABC-001 ' }),
      },
      {
        file: 'beta.two.yaml',
        record: component({ id: 'beta.two', manufacturer: 'acme', part_number: 'abc-001' }),
      },
    );
    await expect(validateDataRoot(root)).rejects.toThrow(
      /Duplicate canonical manufacturer \+ part number/i,
    );
  });

  it('normalizes manufacturer and part number case for collisions', async () => {
    const root = await makeRoot(
      {
        file: 'alpha.one.yaml',
        record: component({ id: 'alpha.one', manufacturer: 'ACME', part_number: 'ABC-001' }),
      },
      {
        file: 'beta.two.yaml',
        record: component({ id: 'beta.two', manufacturer: 'acme', part_number: 'abc-001' }),
      },
    );
    await expect(validateDataRoot(root)).rejects.toThrow(
      /Duplicate canonical manufacturer \+ part number/i,
    );
  });

  it('allows different part numbers to coexist', async () => {
    const root = await makeRoot(
      {
        file: 'alpha.one.yaml',
        record: component({ id: 'alpha.one', manufacturer: 'Acme', part_number: 'ABC-001' }),
      },
      {
        file: 'beta.two.yaml',
        record: component({ id: 'beta.two', manufacturer: 'Acme', part_number: 'ABC-002' }),
      },
    );
    await expect(validateDataRoot(root)).resolves.toMatchObject({ validated: 2 });
  });

  it('does not create false collisions when part_number is absent', async () => {
    const root = await makeRoot(
      {
        file: 'alpha.one.yaml',
        record: component({ id: 'alpha.one', manufacturer: 'Acme', part_number: null }),
      },
      {
        file: 'beta.two.yaml',
        record: component({ id: 'beta.two', manufacturer: 'Acme', part_number: null }),
      },
    );
    await expect(validateDataRoot(root)).resolves.toMatchObject({ validated: 2 });
  });

  it('orders duplicate errors deterministically', async () => {
    const root = await makeRoot(
      {
        file: 'zeta.double.yaml',
        record: component({ id: 'zeta.double', manufacturer: 'Acme', part_number: 'ZZZ-001' }),
      },
      {
        file: 'alpha.double.yaml',
        record: component({ id: 'alpha.double', manufacturer: 'Acme', part_number: 'ZZZ-001' }),
      },
    );
    await expect(validateDataRoot(root)).rejects.toSatisfy((error: Error) => {
      const message = error.message;
      return message.indexOf('alpha.double') < message.indexOf('zeta.double');
    });
  });

  it('rejects filename and id mismatches', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'catalog-validation-'));
    const path = join(dataRoot, 'data');
    await mkdir(join(path, 'schemas'), { recursive: true });
    await mkdir(join(path, 'components'), { recursive: true });
    await writeFile(join(path, 'schemas', 'component.schema.json'), schemaText, 'utf8');
    await writeFile(
      join(path, 'components', 'wrong-name.yaml'),
      stringifyYaml(component({ id: 'expected.name' })),
      'utf8',
    );
    await expect(validateDataRoot(path)).rejects.toThrow(
      /canonical filename must be 'expected.name.yaml'/i,
    );
  });

  it('accepts the existing Victron canonical record in ordinary validation', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'catalog-validation-'));
    const path = join(dataRoot, 'data');
    await mkdir(join(path, 'schemas'), { recursive: true });
    await mkdir(join(path, 'components'), { recursive: true });
    await writeFile(join(path, 'schemas', 'component.schema.json'), schemaText, 'utf8');
    await writeFile(
      join(path, 'components', 'victron-energy.pmp242200100.yaml'),
      realVictronComponent,
      'utf8',
    );
    await expect(validateDataRoot(path)).resolves.toMatchObject({ validated: 1 });
  });
});
