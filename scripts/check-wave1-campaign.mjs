import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEngineeringProfile } from '../packages/engineering-core/dist/engineering-profile.js';
const root = 'data/ingestion/engineering-wave1';
const inventory = JSON.parse(await readFile(`${root}/inventory.json`, 'utf8'));
const requiredBytes = await readFile(`${root}/requirements.json`);
if (createHash('sha256').update(requiredBytes).digest('hex') !== inventory.requirements_digest)
  throw new Error('Frozen assertion-name inventory digest mismatch');
const requirements = JSON.parse(requiredBytes);
if (
  requirements.schema_version !== inventory.requirements_version ||
  new Set(inventory.products.map((p) => p.id)).size !== inventory.products.length
)
  throw new Error('Inventory version or exact identity collision');
for (const p of inventory.products) {
  const r = requirements.products.find((r) => r.id === p.id);
  if (!r || JSON.stringify(r.required_assertions) !== JSON.stringify(p.required_assertions))
    throw new Error(`Independent assertion-name inventory differs: ${p.id}`);
  if (p.states.retained && (!p.states.acquired || !p.current_campaign?.source_digest))
    throw new Error(`Retention lacks acquisition/digest: ${p.id}`);
  // Agent-created campaign data cannot claim human actions without actual
  // independently recorded human lifecycle evidence. This wave records none.
  if (['human_reviewed', 'approved', 'promoted', 'engineering_verified'].some((k) => p.states[k]))
    throw new Error(`Campaign contains unrecorded human authority: ${p.id}`);
  if (p.states.draft_prepared) {
    const expected = `${root}/proposals/${p.id}.profile.json`;
    if (p.preparation.profile_path !== expected) throw new Error('Unexpected proposal path');
    const profile = parseEngineeringProfile(JSON.parse(await readFile(expected, 'utf8')));
    if (
      profile.component_id !== `wave1.${p.id}` ||
      profile.evidence.some((e) => e.origin !== 'source_stated')
    )
      throw new Error('Proposal ownership/origin mismatch');
  }
}
console.log(
  `Validated ${inventory.products.length} exact ledger paths and ${inventory.products.filter((p) => p.states.draft_prepared).length} provisional profiles; no corpus traversal.`,
);
