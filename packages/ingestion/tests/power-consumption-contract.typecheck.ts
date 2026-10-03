import type { PowerConsumptionQualifiers as Ingestion } from '../dist/contracts.js';
import type { PowerConsumptionQualifiers as Engineering } from '../../engineering-core/dist/component-library.js';

type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Intentionally test empty qualifier assignability.
type Empty = {};
type Contradiction = { operating_state: 'off'; display: { state: 'on' } };
type BrightContradiction = {
  operating_state: 'off';
  display: { state: 'on'; brightness_percent: 100 };
};
type Off = { operating_state: 'off'; display: { state: 'off' } };
type Active = { operating_state: 'active'; display: { state: 'off' } };
type Quiescent = { measurement_basis: 'quiescent' };

/** Run with tsc --noEmit after the ingestion and engineering-core builds. */
export type PowerConsumptionContractChecks = [
  AssertFalse<Empty extends Ingestion ? true : false>,
  AssertFalse<Empty extends Engineering ? true : false>,
  AssertFalse<Contradiction extends Ingestion ? true : false>,
  AssertFalse<Contradiction extends Engineering ? true : false>,
  AssertFalse<BrightContradiction extends Ingestion ? true : false>,
  AssertFalse<BrightContradiction extends Engineering ? true : false>,
  AssertTrue<Off extends Ingestion ? true : false>,
  AssertTrue<Off extends Engineering ? true : false>,
  AssertTrue<Active extends Ingestion ? true : false>,
  AssertTrue<Active extends Engineering ? true : false>,
  AssertTrue<Quiescent extends Ingestion ? true : false>,
  AssertTrue<Quiescent extends Engineering ? true : false>,
  AssertTrue<{ supply_voltage_v: 24 } extends Ingestion ? true : false>,
  AssertTrue<{ display: { state: 'on' } } extends Ingestion ? true : false>,
  AssertTrue<{ operating_state: 'off' } extends Ingestion ? true : false>,
  AssertTrue<{ electrical_domain: 'dc' } extends Ingestion ? true : false>,
  AssertFalse<{ operating_state: 'quiescent' } extends Ingestion ? true : false>,
  AssertFalse<{ measurement_basis: 'idle' } extends Ingestion ? true : false>,
  AssertTrue<Ingestion extends Engineering ? true : false>,
  AssertTrue<Engineering extends Ingestion ? true : false>,
];
