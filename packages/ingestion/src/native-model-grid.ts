import { parse, type DefaultTreeAdapterTypes } from 'parse5';
type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const elements = (n: Node): Element[] =>
  'childNodes' in n ? n.childNodes.filter((x): x is Element => 'tagName' in x) : [];
const content = (n: Node): string =>
  'value' in n ? n.value : 'childNodes' in n ? n.childNodes.map(content).join('') : '';
const text = (n: Node) => content(n).replace(/\s+/g, ' ').trim();
export interface NativeModelGridObservation {
  label: string;
  value: string;
  source_literal: string;
  start_byte: number;
  end_byte: number;
  model_literal: string;
  model_start_byte: number;
  model_end_byte: number;
  table_start_byte: number;
  table_end_byte: number;
  label_start_byte: number;
  label_end_byte: number;
  source_row: number;
  value_dom_column: number;
  source_conditions: string[];
}

/** Native exact-column authoring experiment v1. Only one flat table, one source
 * header row and source-declared colspan ownership are supported. A span is an
 * explicit HTML fact, unlike visually aligned PDF text. Every row is validated
 * before returning any observations; nested, repeated, ragged or rowspan axes
 * reject the whole table. This isolated API does not change archived production
 * qualifiers or expand aliases. Full table context remains a human review hold. */
export function nativeModelGridObservations(
  bytes: Uint8Array,
  exactSourceModel: string,
): NativeModelGridObservation[] {
  const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const doc = parse(html, { sourceCodeLocationInfo: true });
  const tables: Element[] = [];
  const walk = (n: Node) => {
    if ('tagName' in n && n.tagName === 'table') tables.push(n);
    elements(n).forEach(walk);
  };
  walk(doc);
  const candidates = tables.filter((t) => {
    const first = elements(t).flatMap((e) =>
      e.tagName === 'tr' ? [e] : ['thead', 'tbody'].includes(e.tagName) ? elements(e) : [],
    )[0];
    return first && elements(first).filter((c) => text(c) === exactSourceModel).length === 1;
  });
  if (candidates.length !== 1) throw new Error('Unique exact source-model header table required');
  const table = candidates[0]!;
  const descendants = (n: Node): Element[] => elements(n).flatMap((e) => [e, ...descendants(e)]);
  if (descendants(table).some((e) => e.tagName === 'table'))
    throw new Error('Nested table unsupported');
  const rows = elements(table).flatMap((e) =>
    e.tagName === 'tr' ? [e] : ['thead', 'tbody', 'tfoot'].includes(e.tagName) ? elements(e) : [],
  );
  if (!rows.length || rows.some((r) => r.tagName !== 'tr')) throw new Error('Malformed rows');
  const header = elements(rows[0]!);
  if (
    header.length < 2 ||
    header.some(
      (c) =>
        c.tagName !== 'th' ||
        c.attrs.some((a) => ['rowspan', 'colspan'].includes(a.name) && a.value !== '1'),
    ) ||
    new Set(header.map(text)).size !== header.length
  )
    throw new Error('Unsupported source header axis');
  // A paired header must name the device itself, not a supported accessory or
  // compatible neighbor. Keep the ordinary model-header-pair device vocabulary
  // intentionally coupled here; prefix resemblance cannot confer ownership.
  const firstLabel = text(header[0]!);
  if (
    header.length === 2
      ? !/^(?:model|product|(?:battery )?monitor|inverter(?:[ /-]charger)?|(?:solar )?charge controller|charger|converter|battery|power station)$/i.test(
          firstLabel,
        )
      : firstLabel !== '' &&
        !/^(?:models?|sku|variants?|parameters?|specifications?)$/i.test(firstLabel)
  )
    throw new Error('Non-owning or unsupported model header class');
  const index = header.findIndex((c) => text(c) === exactSourceModel);
  if (index < 1) throw new Error('Model must own a value column');
  const model = header[index]!,
    modelLoc = model.sourceCodeLocation,
    tableLoc = table.sourceCodeLocation;
  if (!modelLoc || !tableLoc) throw new Error('Missing source offsets');
  const byte = (offset: number) => Buffer.byteLength(html.slice(0, offset), 'utf8');
  const observations: NativeModelGridObservation[] = [];
  for (const row of rows.slice(1)) {
    const cells = elements(row);
    if (
      !cells.length ||
      cells.some(
        (c) =>
          !['td', 'th'].includes(c.tagName) ||
          c.attrs.some((a) => a.name === 'rowspan' && a.value !== '1'),
      )
    )
      throw new Error('Unsupported row structure');
    let column = 0;
    let selected: Element | undefined;
    for (const c of cells) {
      const raw = c.attrs.find((a) => a.name === 'colspan')?.value ?? '1';
      if (!/^[1-9]\d*$/.test(raw)) throw new Error('Malformed source span');
      const span = Number(raw);
      if (!Number.isSafeInteger(span) || span > header.length)
        throw new Error('Span outside source columns');
      if (column <= index && index < column + span) selected = c;
      column += span;
    }
    if (column !== header.length) throw new Error('Ragged source row');
    const label = text(cells[0]!);
    if (
      !label ||
      header.slice(1).some((c) => text(c) === label) ||
      /^(?:models?|sku|part number)$/i.test(label)
    )
      throw new Error('Repeated/competing model axis');
    // Full-width rows are context only. They are never selected as values; all
    // returned rows preserve full table context rather than guessed note scope.
    if (cells.length === 1) continue;
    if (!selected || selected === cells[0]) throw new Error('No independent value ownership');
    const loc = selected.sourceCodeLocation;
    const labelLoc = cells[0]!.sourceCodeLocation;
    if (!loc || !labelLoc) throw new Error('Missing value/label offsets');
    observations.push({
      label,
      value: text(selected),
      source_literal: html.slice(loc.startOffset, loc.endOffset),
      start_byte: byte(loc.startOffset),
      end_byte: byte(loc.endOffset),
      model_literal: text(model),
      model_start_byte: byte(modelLoc.startOffset),
      model_end_byte: byte(modelLoc.endOffset),
      table_start_byte: byte(tableLoc.startOffset),
      table_end_byte: byte(tableLoc.endOffset),
      label_start_byte: byte(labelLoc.startOffset),
      label_end_byte: byte(labelLoc.endOffset),
      source_row: rows.indexOf(row) + 1,
      value_dom_column: cells.indexOf(selected) + 1,
      source_conditions: [
        'Full containing table, section headings and footnotes require independent human qualification',
      ],
    });
  }
  return observations;
}
