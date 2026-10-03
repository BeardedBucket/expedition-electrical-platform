import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { EngineeringPassport } from '../../src/engineering-passport-contracts.js';
import {
  serializeEngineeringPassport,
  serializePassportValue,
} from '../../src/engineering-passport.js';

/** Opt-in application/test-boundary export; ordinary tests have no repository output side effects. */
export const exportPassportProof = (name: string, passport: EngineeringPassport): void => {
  const directory = process.env.PHASE3_PROOF_DIRECTORY;
  if (!directory) return;
  const output = resolve(directory);
  if (!output.startsWith(`${resolve('.tmp')}${sep}`))
    throw new Error('Proof output must stay inside the repository .tmp directory.');
  mkdirSync(output, { recursive: true });
  // Exclusive creation protects any pre-existing local files; the caller owns
  // this optional export directory and explicitly chooses when to produce it.
  writeFileSync(resolve(output, `${name}.passport.json`), serializeEngineeringPassport(passport), {
    flag: 'wx',
  });
  writeFileSync(
    resolve(output, `${name}.catalog.json`),
    serializePassportValue(passport.component_bindings.map((binding) => binding.record)),
    { flag: 'wx' },
  );
  writeFileSync(resolve(output, `${name}.input.json`), serializePassportValue(passport.input), {
    flag: 'wx',
  });
};
