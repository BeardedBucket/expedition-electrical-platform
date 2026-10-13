import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type {
  EngineeringProfile,
  EngineeringValue,
} from '@expedition/engineering-core/engineering-profile';
import {
  prepareEngineeringProfile,
  type RetainedEngineeringSource,
  type EngineeringSourceBinding,
} from './engineering-preparation.js';
import { createHash } from 'node:crypto';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const elements = (node: Node): Element[] =>
  'childNodes' in node ? node.childNodes.filter((n): n is Element => 'tagName' in n) : [];
const content = (node: Node): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(content).join('') : '';
const text = (node: Node) => content(node).replace(/\s+/g, ' ').trim();

/** Closed native-list source grammar v1: exact first Product Code item, one
 * directly owning container, and direct sibling UL lists. Source values never
 * come from a benchmark inventory or target hints. Unsupported rows remain raw
 * evidence; operating temperature does not become a coefficient validity domain.
 * This authoring experiment grants neither human qualification nor admission. */
export function prepareNativePvReference(input: {
  source: RetainedEngineeringSource;
  exact_model: string;
  component_id: string;
  required_assertions: string[];
}) {
  const { source } = input;
  const html = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes);
  const document = parse(html, { sourceCodeLocationInfo: true });
  const candidates: Element[] = [];
  const walk = (node: Node) => {
    if ('tagName' in node && node.tagName === 'ul') {
      const children = elements(node);
      if (
        children[0]?.tagName === 'li' &&
        text(children[0]) === `Product Code ${input.exact_model}`
      )
        candidates.push(node);
    }
    elements(node).forEach(walk);
  };
  walk(document);
  if (candidates.length !== 1) throw new Error('Unique native exact Product Code list required');
  const list = candidates[0]!;
  const parent = list.parentNode;
  if (!parent) throw new Error('Missing directly owning container');
  const groups = elements(parent);
  if (!groups.length || groups.some((g) => g.tagName !== 'ul'))
    throw new Error('Unsupported competing specification container');
  const items = groups.flatMap((g) => elements(g));
  if (
    items.some((i) => i.tagName !== 'li') ||
    items.filter((i) => /^Product Code\b/i.test(text(i))).length !== 1
  )
    throw new Error('Competing model/row ownership');
  const sourceDigest = createHash('sha256').update(source.bytes).digest('hex');
  const profile: EngineeringProfile = {
    schema_version: 'engineering-profile.v1',
    component_id: input.component_id,
    model: input.exact_model,
    manufacturer_revision: source.manufacturer_revision,
    evidence: [],
    pv: {},
  };
  const bindings: EngineeringSourceBinding[] = [];
  const seen = new Set<string>();
  const record = (item: Element, label: string, n: number, unit: string): EngineeringValue => {
    if (seen.has(label)) throw new Error(`Competing PV assertion ${label}`);
    seen.add(label);
    const loc = item.sourceCodeLocation;
    const owner = list.sourceCodeLocation;
    if (!loc || !owner) throw new Error('Missing native source offsets');
    const id = `${input.component_id}.${label}`;
    const start = Buffer.byteLength(html.slice(0, loc.startOffset), 'utf8');
    const end = Buffer.byteLength(html.slice(0, loc.endOffset), 'utf8');
    const statement = text(item);
    const context = `native-list bytes ${Buffer.byteLength(html.slice(0, owner.startOffset), 'utf8')}-${Buffer.byteLength(html.slice(0, owner.endOffset), 'utf8')}`;
    profile.evidence.push({
      id,
      source_url: source.source_url,
      publisher: source.publisher,
      model: input.exact_model,
      manufacturer_revision: source.manufacturer_revision,
      retrieved_at: source.retrieved_at,
      locator: `utf8-bytes:${start}-${end}`,
      source_digest: sourceDigest,
      statement,
      conditions: [
        'Exact Product Code in same native container; full surrounding source awaits human context review',
      ],
      origin: 'source_stated',
      rights: 'metadata_and_limited_facts_only',
    });
    bindings.push({
      evidence_id: id,
      source_digest: sourceDigest,
      source_url: source.source_url,
      start_byte: start,
      end_byte: end,
      source_literal: html.slice(loc.startOffset, loc.endOffset),
      ownership: 'native_exact_model',
      context_locators: [context],
    });
    return { value: n, unit, evidence_ids: [id] };
  };
  const scalar = [
    ['pmax_w', /^Maximum Power \(Pmax\)\s+([+-]?\d+(?:\.\d+)?)\s*W$/, 'W'],
    ['vmp_v', /^Voltage at Pmax \(Vmp\)\s+([+-]?\d+(?:\.\d+)?)\s*V$/, 'V'],
    ['imp_a', /^Current at Pmax \(Imp\)\s+([+-]?\d+(?:\.\d+)?)\s*A$/, 'A'],
    ['voc_v', /^Open-Circuit Voltage \(Voc\)\s+([+-]?\d+(?:\.\d+)?)\s*V$/, 'V'],
    ['isc_a', /^Short-Circuit Current \(Isc\)\s+([+-]?\d+(?:\.\d+)?)\s*A$/, 'A'],
    ['max_system_v', /^Max System Voltage\s+([+-]?\d+(?:\.\d+)?)\s*V DC$/, 'V'],
  ] as const;
  for (const item of items) {
    for (const [target, pattern, unit] of scalar) {
      const match = pattern.exec(text(item));
      if (match)
        (profile.pv as Record<string, unknown>)[target] = record(
          item,
          target,
          Number(match[1]),
          unit,
        );
    }
    const coeff = /^Temp\. Coeff\. of (Power|Voc)\s+([+-]?\d+(?:\.\d+)?)\s*%\/K$/.exec(text(item));
    if (coeff) {
      const q = coeff[1] === 'Voc' ? 'voc' : 'pmax';
      const v = record(item, `coefficient_${q}`, Number(coeff[2]), 'percent/K');
      profile.pv!.coefficients ??= {};
      profile.pv!.coefficients[q] = { ...v, unit: 'percent/K' };
    }
  }
  if (!profile.evidence.length) throw new Error('No supported PV source assertions');
  return prepareEngineeringProfile({
    profile,
    bindings,
    sources: [source],
    required_assertions: input.required_assertions,
    unresolved: [
      'Human source qualification and product approval required',
      'Reference cell temperature/irradiance/spectrum not established by this grammar',
      'Coefficient domain, Vmp coefficient, voltage/current uncertainty, series fuse and connector constraints unresolved',
    ],
  });
}
