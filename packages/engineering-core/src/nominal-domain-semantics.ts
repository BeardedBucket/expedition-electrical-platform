import type { CapabilityType } from './component-library.js';
import type { PassportStatus } from './engineering-passport-contracts.js';
import type { InstalledElectricalDomain } from './installed-power-topology.js';

/** Shared Phase 3/4 nominal interpretation; no product evidence or generation policy enters here. */
export const statusOf = (states: readonly PassportStatus[]): PassportStatus =>
  states.includes('blocked')
    ? 'blocked'
    : states.includes('unresolved')
      ? 'unresolved'
      : 'satisfied';

// PV context is erased only for canonical current-type matching, never continuity.
export const dcKind = (domain: InstalledElectricalDomain) =>
  domain.kind === 'pv_dc' ? 'dc' : domain.kind;

export const passiveDomainStates = (
  from: InstalledElectricalDomain,
  to: InstalledElectricalDomain,
): PassportStatus[] => {
  const known = from.nominal_voltage_v !== undefined && to.nominal_voltage_v !== undefined;
  const states: PassportStatus[] = [
    dcKind(from) !== dcKind(to) || (known && from.nominal_voltage_v !== to.nominal_voltage_v)
      ? 'blocked'
      : !known
        ? 'unresolved'
        : 'satisfied',
  ];
  // Equal nominal points cannot establish PV operating/source continuity.
  if (from.kind !== to.kind && dcKind(from) === dcKind(to)) states.push('unresolved');
  if (from.kind === 'ac' || to.kind === 'ac')
    states.push(
      from.frequency_hz === undefined || to.frequency_hz === undefined
        ? 'unresolved'
        : from.frequency_hz === to.frequency_hz
          ? 'satisfied'
          : 'blocked',
    );
  return states;
};

export const powerPathDomainStates = (
  capability: CapabilityType,
  from: InstalledElectricalDomain,
  to: InstalledElectricalDomain,
): PassportStatus[] => {
  const kinds = [dcKind(from), dcKind(to)].join(':');
  const permitted =
    capability === 'dc_to_dc_conversion' || capability === 'solar_energy_conversion'
      ? kinds === 'dc:dc'
      : capability === 'inversion'
        ? kinds === 'dc:ac'
        : capability === 'charging'
          ? kinds === 'ac:dc' || kinds === 'dc:dc'
          : false;
  const states: PassportStatus[] = [permitted ? 'satisfied' : 'blocked'];
  if (
    from.kind !== to.kind &&
    dcKind(from) === dcKind(to) &&
    capability !== 'solar_energy_conversion'
  )
    states.push('unresolved');
  return states;
};
