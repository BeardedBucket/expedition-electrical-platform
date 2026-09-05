import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const dataRoot = join(process.cwd(), 'data');
const schemaRoot = join(dataRoot, 'schemas');
const schemaByCollection = {
  components: 'component.schema.json',
  builders: 'builder.schema.json',
  advisories: 'advisory.schema.json',
  rules: 'rule.schema.json',
  engineering: 'engineering.schema.json',
};

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await jsonFiles(path)));
    } else if (extname(entry.name) === '.json') {
      files.push(path);
    }
  }
  return files;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schemaFiles = await jsonFiles(schemaRoot);
const validators = new Map();

for (const schemaFile of schemaFiles) {
  const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
  ajv.compile(schema);
  validators.set(schemaFile, schema);
  console.log(`schema ok: ${relative(process.cwd(), schemaFile)}`);
}

const dataFiles = (await jsonFiles(dataRoot)).filter((file) => !file.startsWith(schemaRoot));
let validated = 0;
const advisoryIds = new Set();
const evidenceIds = new Set();

for (const dataFile of dataFiles) {
  const pathParts = relative(dataRoot, dataFile).split(sep);
  const collection = pathParts[0];
  const schemaName = schemaByCollection[collection];
  if (!schemaName) {
    throw new Error(`No schema mapping for data file: ${relative(process.cwd(), dataFile)}`);
  }

  const schemaFile = join(schemaRoot, schemaName);
  const validate = ajv.compile(validators.get(schemaFile));
  const document = JSON.parse(await readFile(dataFile, 'utf8'));
  if (!validate(document)) {
    throw new Error(
      `${relative(process.cwd(), dataFile)} failed validation:\n${ajv.errorsText(validate.errors)}`,
    );
  }
  if (collection === 'advisories') {
    const records = Array.isArray(document) ? document : [document];
    for (const record of records) {
      if (advisoryIds.has(record.id))
        throw new Error(
          `${relative(process.cwd(), dataFile)} has duplicate advisory ID '${record.id}'.`,
        );
      advisoryIds.add(record.id);
      if (
        record.created_at &&
        record.updated_at &&
        Date.parse(record.updated_at) < Date.parse(record.created_at)
      ) {
        throw new Error(
          `${relative(process.cwd(), dataFile)} has updated_at earlier than created_at.`,
        );
      }
      for (const evidence of record.evidence ?? []) {
        if (evidenceIds.has(evidence.id))
          throw new Error(
            `${relative(process.cwd(), dataFile)} has duplicate evidence ID '${evidence.id}'.`,
          );
        evidenceIds.add(evidence.id);
        if (!Array.isArray(evidence.sources) || evidence.sources.length === 0) {
          throw new Error(
            `${relative(process.cwd(), dataFile)} evidence '${evidence.id}' is missing provenance.`,
          );
        }
      }
      for (const evidenceId of record.evidence_ids ?? []) {
        if (!(record.evidence ?? []).some((evidence) => evidence.id === evidenceId)) {
          throw new Error(
            `${relative(process.cwd(), dataFile)} advisory '${record.id}' references missing evidence '${evidenceId}'.`,
          );
        }
      }
      if (record.supersedes === record.id || record.superseded_by === record.id) {
        throw new Error(
          `${relative(process.cwd(), dataFile)} advisory '${record.id}' self-references supersession.`,
        );
      }
    }
  }
  validated += 1;
  console.log(`data ok: ${relative(process.cwd(), dataFile)}`);
}

console.log(`Validated ${validated} data file(s) against ${schemaFiles.length} schema file(s).`);
