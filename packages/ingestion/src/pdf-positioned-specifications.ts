import type { ExtractedBlock, ExtractionSourceLocation } from './capture-types.js';

export const PDF_POSITIONED_SPECIFICATIONS = 'pdf-positioned-label-value.v1';

/** A literal shared identifier list, not slash-containing prose or substring matching. */
export function pdfSharedIdentifiers(text: string): readonly string[] | undefined {
  const identifiers = text.split('/').map((part) => part.trim());
  if (
    identifiers.length < 2 ||
    identifiers.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) || !/\d/.test(part)) ||
    new Set(identifiers).size !== identifiers.length
  )
    return undefined;
  return identifiers;
}

export interface PositionedPdfItem {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly upright: boolean;
  readonly location: ExtractionSourceLocation;
}

/** Narrow source-shape grammar: one shared-ID title and one Specifications heading
 * per page, followed by an exact-baseline, repeated-column run. Exact coordinate
 * equality deliberately avoids an invented geometric tolerance. No wrapped,
 * rotated, merged, overlapping, or three-column rows are reconstructed.
 */
export function positionedPdfSpecifications(
  items: readonly PositionedPdfItem[],
): ExtractedBlock | undefined {
  const headings = items.filter((item) => item.text === 'Specifications');
  if (headings.length !== 1) return undefined;
  const heading = headings[0];
  const identities = items.filter(
    (item) => item.height > heading.height && pdfSharedIdentifiers(item.text),
  );
  if (identities.length !== 1 || items.some((item) => !item.upright)) return undefined;
  const identity = identities[0];
  if (identity.location.ordinal! >= heading.location.ordinal!) return undefined;
  const start = items.indexOf(heading) + 1;
  // A larger heading at the same left edge ends this source-authored section.
  const body = items.slice(start);
  const first = body[0];
  if (!first || first.x !== heading.x || first.height >= heading.height) return undefined;
  const boundary = body.findIndex((item) => item.x === heading.x && item.height > first.height);
  const section = boundary < 0 ? body : body.slice(0, boundary);
  if (!section.length) return undefined;
  const lines: PositionedPdfItem[][] = [];
  for (const item of section) {
    // A section must be contiguous in source order; another page column cannot
    // lend text to a specification row.
    if (item.x < heading.x || item.height !== first.height) return undefined;
    const last = lines.at(-1);
    if (last?.[0].y === item.y) last.push(item);
    else lines.push([item]);
  }
  const pairs: (readonly [PositionedPdfItem, PositionedPdfItem])[] = [];
  let trailingUnsupported = false;
  let rightColumn: number | undefined;
  let pitch: number | undefined;
  for (const line of lines) {
    if (line.length > 2) return undefined;
    if (line.length !== 2) {
      // An unpaired tail stays ordinary text. Unpaired text between paired rows
      // is a possible wrap/continuation and rejects the complete run. Withhold
      // the immediately preceding pair too: a left-column tail could qualify
      // its label. A right-column tail could continue its value and rejects scope.
      if (rightColumn === undefined || line[0].x >= rightColumn) return undefined;
      if (!trailingUnsupported) pairs.pop();
      trailingUnsupported = true;
      continue;
    }
    if (trailingUnsupported) return undefined;
    const [label, value] = line;
    if (
      label.x !== heading.x ||
      value.x <= label.x + label.width ||
      (rightColumn !== undefined && value.x !== rightColumn)
    )
      return undefined;
    if (pairs.length) {
      const delta = pairs.at(-1)![0].y - label.y;
      if (delta <= 0 || (pitch !== undefined && delta !== pitch)) return undefined;
      pitch = delta;
    }
    rightColumn = value.x;
    pairs.push([label, value]);
  }
  // Repetition proves column ownership; a single aligned pair is insufficient.
  if (pairs.length < 2) return undefined;
  const table = `pdf-positioned-region-${heading.location.page}-${heading.location.ordinal}`;
  const cells: NonNullable<ExtractedBlock['cells']>[number][] = [
    {
      label: identity.text,
      value: identity.text,
      kind: 'header',
      row: 1,
      column: 1,
      source_location: identity.location,
    },
    {
      label: heading.text,
      value: heading.text,
      kind: 'header',
      row: 2,
      column: 1,
      source_location: heading.location,
    },
  ];
  pairs.forEach(([label, value], index) => {
    for (const [column, item] of [label, value].entries())
      cells.push({
        label: item.text,
        value: item.text,
        kind: 'data',
        row: index + 3,
        column: column + 1,
        source_location: item.location,
      });
  });
  return {
    id: table,
    kind: 'table',
    text: '',
    locator: {
      fragment: heading.location.fragment!,
      path: heading.location.path,
      page: heading.location.page,
      section: PDF_POSITIONED_SPECIFICATIONS,
      table,
    },
    source_location: { ...heading.location, section: PDF_POSITIONED_SPECIFICATIONS, table },
    cells,
  };
}
