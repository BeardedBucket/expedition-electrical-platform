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
  validated += 1;
  console.log(`data ok: ${relative(process.cwd(), dataFile)}`);
}

console.log(`Validated ${validated} data file(s) against ${schemaFiles.length} schema file(s).`);
