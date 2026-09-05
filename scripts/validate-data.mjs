import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const schemaByCollection = {
  components: 'component.schema.json',
  builders: 'builder.schema.json',
  advisories: 'advisory.schema.json',
  rules: 'rule.schema.json',
  engineering: 'engineering.schema.json',
};
const componentSupportedExtensions = new Set(['.yaml']);

const displayPath = (filePath, rootDir = process.cwd()) =>
  relative(rootDir, filePath).split(sep).join('/');

async function recursiveFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await recursiveFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files.sort((left, right) =>
    displayPath(left, directory).localeCompare(displayPath(right, directory)),
  );
}

const readDataFile = async (dataFile) => {
  const extension = extname(dataFile).toLowerCase();
  const documentText = await readFile(dataFile, 'utf8');
  if (extension === '.json') return JSON.parse(documentText);
  if (extension === '.yaml' || extension === '.yml') return parseYaml(documentText);
  throw new Error(
    `Unsupported data file extension for ${displayPath(dataFile)}: ${extension || '(none)'}`,
  );
};

const normalizeComponentKey = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export const validateDataRoot = async (dataRoot = join(process.cwd(), 'data')) => {
  const schemaRoot = join(dataRoot, 'schemas');
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemaFiles = (await recursiveFiles(schemaRoot)).filter(
    (file) => extname(file) === '.json',
  );
  const validators = new Map();

  for (const schemaFile of schemaFiles) {
    const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
    ajv.compile(schema);
    validators.set(schemaFile, schema);
    console.log(`schema ok: ${displayPath(schemaFile, process.cwd())}`);
  }

  const dataFiles = (await recursiveFiles(dataRoot)).filter((file) => !file.startsWith(schemaRoot));
  let validated = 0;
  const advisoryIds = new Set();
  const evidenceIds = new Set();
  const componentIdCollisions = new Map();
  const componentManufacturerPartCollisions = new Map();

  for (const dataFile of dataFiles) {
    if (basename(dataFile) === '.gitkeep') continue;
    const relativePath = displayPath(dataFile, process.cwd());
    const pathParts = relative(dataRoot, dataFile).split(sep);
    const collection = pathParts[0];
    if (collection === 'ingestion' || collection === 'templates') continue;

    if (collection === 'components') {
      const fileName = basename(dataFile);
      if (fileName === '.gitkeep') continue;
      const extension = extname(dataFile).toLowerCase();
      if (!componentSupportedExtensions.has(extension)) {
        throw new Error(
          `${relativePath} has unsupported extension '${extension}' for canonical components; expected .yaml.`,
        );
      }

      const document = await readDataFile(dataFile);
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new Error(`${relativePath} must contain a single component object.`);
      }

      const schemaName = schemaByCollection[collection];
      const schemaFile = join(schemaRoot, schemaName);
      const validate = ajv.compile(validators.get(schemaFile));
      if (!validate(document)) {
        throw new Error(`${relativePath} failed validation:\n${ajv.errorsText(validate.errors)}`);
      }

      const componentId = typeof document.id === 'string' ? document.id.trim() : '';
      if (!componentId) {
        throw new Error(`${relativePath} is missing a non-empty component id.`);
      }

      const expectedFilename = `${componentId}.yaml`;
      if (fileName !== expectedFilename) {
        throw new Error(
          `${relativePath} canonical filename must be '${expectedFilename}' to match component id '${componentId}'.`,
        );
      }

      if (componentIdCollisions.has(componentId)) {
        const first = componentIdCollisions.get(componentId);
        throw new Error(
          `Duplicate canonical component ID '${componentId}' in data/components:\n- ${first}\n- ${relativePath}`,
        );
      }
      componentIdCollisions.set(componentId, relativePath);

      const manufacturer = normalizeComponentKey(document.manufacturer);
      const partNumber =
        typeof document.part_number === 'string' ? document.part_number.trim() : null;
      const normalizedPartNumber = partNumber ? partNumber.trim().toLowerCase() : null;
      if (manufacturer && normalizedPartNumber) {
        const key = `${manufacturer}::${normalizedPartNumber}`;
        if (componentManufacturerPartCollisions.has(key)) {
          const first = componentManufacturerPartCollisions.get(key);
          throw new Error(
            `Duplicate canonical manufacturer + part number '${document.manufacturer}' / '${partNumber}' in data/components:\n- ${first}\n- ${relativePath}`,
          );
        }
        componentManufacturerPartCollisions.set(key, relativePath);
      }

      validated += 1;
      console.log(`data ok: ${relativePath}`);
      continue;
    }

    const schemaName = schemaByCollection[collection];
    if (!schemaName) {
      throw new Error(`No schema mapping for data file: ${relativePath}`);
    }

    const schemaFile = join(schemaRoot, schemaName);
    const validate = ajv.compile(validators.get(schemaFile));
    const document = await readDataFile(dataFile);
    if (!validate(document)) {
      throw new Error(`${relativePath} failed validation:\n${ajv.errorsText(validate.errors)}`);
    }
    if (collection === 'advisories') {
      const records = Array.isArray(document) ? document : [document];
      for (const record of records) {
        if (advisoryIds.has(record.id)) {
          throw new Error(`${relativePath} has duplicate advisory ID '${record.id}'.`);
        }
        advisoryIds.add(record.id);
        if (
          record.created_at &&
          record.updated_at &&
          Date.parse(record.updated_at) < Date.parse(record.created_at)
        ) {
          throw new Error(`${relativePath} has updated_at earlier than created_at.`);
        }
        for (const evidence of record.evidence ?? []) {
          if (evidenceIds.has(evidence.id)) {
            throw new Error(`${relativePath} has duplicate evidence ID '${evidence.id}'.`);
          }
          evidenceIds.add(evidence.id);
          if (!Array.isArray(evidence.sources) || evidence.sources.length === 0) {
            throw new Error(`${relativePath} evidence '${evidence.id}' is missing provenance.`);
          }
        }
        for (const evidenceId of record.evidence_ids ?? []) {
          if (!(record.evidence ?? []).some((evidence) => evidence.id === evidenceId)) {
            throw new Error(
              `${relativePath} advisory '${record.id}' references missing evidence '${evidenceId}'.`,
            );
          }
        }
        if (record.supersedes === record.id || record.superseded_by === record.id) {
          throw new Error(`${relativePath} advisory '${record.id}' self-references supersession.`);
        }
        if (
          record.policy_action !== undefined &&
          record.policy_action !== 'none' &&
          (!Array.isArray(record.evidence_ids) || record.evidence_ids.length === 0)
        ) {
          throw new Error(
            `${relativePath} advisory '${record.id}' has an influential policy_action without evidence_ids.`,
          );
        }
        if (record.reviewed_decision) {
          const decision = record.reviewed_decision;
          if (
            decision.reviewed_at &&
            record.created_at &&
            Date.parse(decision.reviewed_at) < Date.parse(record.created_at)
          ) {
            throw new Error(
              `${relativePath} advisory '${record.id}' reviewed_decision.reviewed_at is earlier than created_at.`,
            );
          }
          if (
            decision.reviewed_at &&
            record.updated_at &&
            Date.parse(record.updated_at) < Date.parse(decision.reviewed_at)
          ) {
            throw new Error(
              `${relativePath} advisory '${record.id}' updated_at is earlier than reviewed_decision.reviewed_at.`,
            );
          }
        }
      }
    }

    validated += 1;
    console.log(`data ok: ${relativePath}`);
  }

  console.log(`Validated ${validated} data file(s) against ${schemaFiles.length} schema file(s).`);
  return { validated, schemaCount: schemaFiles.length };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await validateDataRoot();
}
