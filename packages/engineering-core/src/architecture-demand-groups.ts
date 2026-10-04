import type { ArchitectureRequirements } from './architecture-generation-contracts.js';
import { passportDigest, serializePassportValue } from './portable-json.js';

/** One deterministic partition, not a per-load product or sharing search dimension.
 * Only complete equal DC or AC design points establish nominal compatibility.
 * Explicit isolation owns a dedicated boundary; missing voltage/frequency and PV
 * consumption remain separate because unknown compatibility is not permission.
 * Powers and schedules never participate: they cannot establish concurrency.
 */
export const groupArchitectureDemands = (loads: ArchitectureRequirements['loads']) => {
  const groups = new Map<
    string,
    {
      id: string;
      domain: ArchitectureRequirements['loads'][number]['domain'];
      members: {
        load: ArchitectureRequirements['loads'][number];
        index: number;
      }[];
    }
  >();
  loads.forEach((load, index) => {
    const complete =
      load.domain.nominal_voltage_v !== undefined &&
      (load.domain.kind === 'ac'
        ? load.domain.frequency_hz !== undefined
        : load.domain.kind === 'dc' && load.domain.frequency_hz === undefined);
    const key = serializePassportValue({
      domain: load.domain,
      ...(complete && load.requires_isolation !== true ? {} : { boundary: load.id }),
    });
    let group = groups.get(key);
    if (!group) {
      group = {
        id: passportDigest(JSON.parse(key)).slice('sha256:'.length),
        domain: load.domain,
        members: [],
      };
      groups.set(key, group);
    }
    group.members.push({ load, index });
  });
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, group]) => ({
      ...group,
      members: group.members.sort((a, b) =>
        a.load.id < b.load.id ? -1 : a.load.id > b.load.id ? 1 : 0,
      ),
    }));
};
