import {
  PDF_SOURCE_LAYOUT,
  PDF_LAYOUT_COMPARISON_BUDGET,
  glyphBottom,
  glyphTop,
  sameLine,
  type PdfLayoutItem,
  type PdfSourceLayout,
} from './pdf-layout-structure.js';
import { qualifiedContext } from './qualified-context.js';
import { pdfGridCells, PDF_VECTOR_STRUCTURE } from './pdf-vector-structure.js';
import {
  artifactReference,
  buildQualifiedFactArtifact,
  type DocumentBlock,
  type DocumentExtractionArtifact,
  type DocumentQualificationTarget,
  type QualifiedFactArtifact,
  type QualifiedFactEvidence,
} from './production-contracts.js';

type Item = PdfLayoutItem;
interface Region {
  left: number;
  right: number;
  bottom: number;
  top: number;
  items: Item[];
  operators: number[];
}
interface Relationship {
  label: Item[];
  value: Item[];
  identity: Item[];
  sections: Item[];
  proof: string;
  unresolved?: string;
}
const words = (items: readonly Item[]) =>
  [...items]
    .sort((a, b) => (sameLine(a, b) ? a.x - b.x : b.y - a.y || a.x - b.x))
    .map((i) => i.text)
    .join(' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && Object.keys(v).every((k) => keys.includes(k));

/** Revalidate complete raw-item links and the closed payload before reconstructing
 * relationships. A marker, a requested SKU or a proposed bounding box is never
 * authority. Geometry/font data belongs to the extraction artifact's digest;
 * every literal still refers to the ordinary source text item and capture.
 */
function readLayout(
  document: DocumentExtractionArtifact,
  block: DocumentBlock,
): PdfSourceLayout | undefined {
  if (
    document.status !== 'extracted' ||
    block.kind !== 'structured' ||
    block.locator.kind !== 'pdf' ||
    block.locator.section !== PDF_SOURCE_LAYOUT
  )
    return undefined;
  try {
    const data: unknown = JSON.parse(block.content ?? '');
    if (
      !object(data) ||
      !closed(data, ['version', 'items', 'rules']) ||
      data.version !== PDF_SOURCE_LAYOUT ||
      !Array.isArray(data.items) ||
      !Array.isArray(data.rules)
    )
      return undefined;
    const raw = document.blocks.filter(
      (b) => b.kind === 'text_block' && b.locator.page === block.locator.page,
    );
    const seen = new Set<number>();
    for (const i of data.items) {
      if (
        !object(i) ||
        !closed(i, [
          'text',
          'x',
          'y',
          'width',
          'height',
          'upright',
          'location',
          'font',
          'ascent',
          'descent',
        ]) ||
        typeof i.text !== 'string' ||
        typeof i.font !== 'string' ||
        !i.font ||
        typeof i.upright !== 'boolean' ||
        !['x', 'y', 'width', 'height', 'ascent', 'descent'].every(
          (k) => typeof i[k] === 'number' && Number.isFinite(i[k]),
        ) ||
        Number(i.width) < 0 ||
        Number(i.height) <= 0 ||
        Number(i.ascent) <= Number(i.descent) ||
        !object(i.location)
      )
        return undefined;
      const loc = i.location;
      if (
        loc.kind !== 'pdf' ||
        loc.page !== block.locator.page ||
        !Number.isSafeInteger(loc.ordinal) ||
        seen.has(Number(loc.ordinal))
      )
        return undefined;
      const source = raw.find((b) => b.locator.ordinal === loc.ordinal);
      if (
        !source ||
        source.content !== i.text ||
        source.locator.path !== loc.path ||
        source.locator.fragment !== loc.fragment
      )
        return undefined;
      seen.add(Number(loc.ordinal));
    }
    if (seen.size !== raw.length) return undefined;
    for (const r of data.rules) {
      if (
        !object(r) ||
        !closed(r, ['a', 'b', 'ink', 'operator']) ||
        ![r.a, r.b].every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ||
        typeof r.ink !== 'number' ||
        !Number.isFinite(r.ink) ||
        r.ink < 0 ||
        !Number.isSafeInteger(r.operator) ||
        Number(r.operator) < 1
      )
        return undefined;
    }
    // Same conservative comparison envelope as v1: metadata is already bounded
    // by extraction, but quadratic layout work must also be bounded. Overflow
    // retains raw evidence without structural authority, never a partial table.
    if ((data.items.length + data.rules.length) ** 2 > PDF_LAYOUT_COMPARISON_BUDGET)
      return undefined;
    return data as unknown as PdfSourceLayout;
  } catch {
    return undefined;
  }
}

/** A single renderer operation's rectangle is independent evidence. Do not
 * compose unrelated edges into a convenient box. Actual font ascent/descent
 * fixes v1's baseline-plus-em rejection of otherwise enclosed source glyphs.
 * Nested paint rectangles are allowed only when their source item sets agree;
 * competing overlapping cells are excluded rather than selected by proximity.
 */
function rectangles(layout: PdfSourceLayout): Region[] {
  const groups = new Map<number, typeof layout.rules>();
  for (const r of layout.rules) groups.set(r.operator, [...(groups.get(r.operator) ?? []), r]);
  const regions: Region[] = [];
  for (const [operator, rules] of groups) {
    if (rules.length !== 4) continue;
    const horizontal = rules.filter((r) => r.a[1] === r.b[1]);
    const vertical = rules.filter((r) => r.a[0] === r.b[0]);
    if (horizontal.length !== 2 || vertical.length !== 2) continue;
    const left = Math.min(...vertical.map((r) => r.a[0])),
      right = Math.max(...vertical.map((r) => r.a[0]));
    const bottom = Math.min(...horizontal.map((r) => r.a[1])),
      top = Math.max(...horizontal.map((r) => r.a[1]));
    if (
      left === right ||
      bottom === top ||
      horizontal.some(
        (r) => Math.min(r.a[0], r.b[0]) !== left || Math.max(r.a[0], r.b[0]) !== right,
      ) ||
      vertical.some((r) => Math.min(r.a[1], r.b[1]) !== bottom || Math.max(r.a[1], r.b[1]) !== top)
    )
      continue;
    const ink = Math.max(...rules.map((r) => r.ink)) / 2;
    // Source baselines own painted rows. Font metric boxes can overhang the
    // paint by design; reject an em larger than the row, but do not truncate a
    // wrapped label merely because its font ascent crosses a background edge.
    const items = layout.items.filter(
      (i) =>
        i.x >= left - ink &&
        i.x + i.width <= right + ink &&
        i.y >= bottom - ink &&
        i.y <= top + ink &&
        glyphTop(i) - glyphBottom(i) <= top - bottom + ink * 2,
    );
    if (items.length)
      regions.push({ left, right, bottom, top, items: [...items], operators: [operator] });
  }
  return regions.filter(
    (r) =>
      !regions.some(
        (s) =>
          s !== r &&
          s.left <= r.left &&
          s.right >= r.right &&
          s.bottom <= r.bottom &&
          s.top >= r.top &&
          (s.left < r.left || s.right > r.right || s.bottom < r.bottom || s.top > r.top) &&
          s.items.length === r.items.length &&
          s.items.every((i) => r.items.includes(i)),
      ),
  );
}
const rowOverlap = (a: Region, b: Region) => Math.max(a.bottom, b.bottom) < Math.min(a.top, b.top);
const upperHeading = (s: string) =>
  /[A-Z]/.test(s) && s.replace(/\([^)]*\)/g, '') === s.replace(/\([^)]*\)/g, '').toUpperCase();
const identities = (target: DocumentQualificationTarget) =>
  [target.product_model, target.target_identifier, target.manufacturer_part_number]
    .filter((v): v is string => !!v?.trim())
    .map((v) => v.trim());
const literalIdentity = (items: readonly Item[], target: DocumentQualificationTarget) =>
  identities(target).some(
    (s) =>
      words(items) === s ||
      [...items]
        .sort((a, b) => a.x - b.x)
        .map((i) => i.text)
        .join('') === s,
  );

function paintedRelationships(
  layout: PdfSourceLayout,
  target: DocumentQualificationTarget,
): Relationship[] {
  const cells = rectangles(layout);
  const headers = cells.filter((c) => literalIdentity(c.items, target));
  const unique = [
    ...new Map(headers.map((c) => [c.items.map((i) => i.location.ordinal).join(','), c])).values(),
  ];
  if (unique.length !== 1) return [];
  const header = unique[0];
  const headerLabels = cells.filter((c) => c.right <= header.left && rowOverlap(c, header));
  if (headerLabels.length !== 1) return [];
  const labelColumn = headerLabels[0];
  const columnFits = (c: Region, h: Region) =>
    Math.abs(c.left - h.left) <= Math.min(c.items[0].height, h.items[0].height) / 4 &&
    Math.abs(c.right - h.right) <= Math.min(c.items[0].height, h.items[0].height) / 4;
  const relationships: Relationship[] = [];
  const valueOptions = cells.filter(
    (c) => c.top <= header.top && c !== header && columnFits(c, header),
  );
  const ownedValues = valueOptions.filter(
    (c) =>
      !valueOptions.some(
        (s) =>
          s !== c &&
          s.left <= c.left &&
          s.right >= c.right &&
          s.bottom <= c.bottom &&
          s.top >= c.top,
      ),
  );
  for (const value of ownedValues) {
    const options = cells.filter((c) => columnFits(c, labelColumn) && rowOverlap(c, value));
    const labels = options.filter(
      (c) =>
        !options.some(
          (s) =>
            s !== c &&
            s.left <= c.left &&
            s.right >= c.right &&
            s.bottom <= c.bottom &&
            s.top >= c.top,
        ),
    );
    if (labels.length !== 1) continue;
    const label = labels[0];
    if (label === labelColumn || value.items.some((i) => i.y >= header.items[0].y)) continue;
    if (
      label.items.some((i) => i.y > value.top || i.y < value.bottom) ||
      value.items.some((i) => i.y > label.top || i.y < label.bottom)
    )
      continue;
    const groups = cells.filter(
      (c) =>
        c.left < labelColumn.left &&
        c.right <= labelColumn.left &&
        c.bottom <= value.bottom &&
        c.top >= value.top &&
        c.items.length === 1,
    );
    const heading = cells
      .filter(
        (c) =>
          c.left <= labelColumn.left &&
          c.right >= header.right &&
          c.bottom >= value.top &&
          c.items.length === 1 &&
          upperHeading(words(c.items)),
      )
      .sort((a, b) => a.bottom - b.bottom)[0];
    const sections = [...groups, ...(heading ? [heading] : [])];
    relationships.push({
      label: label.items,
      value: value.items,
      identity: header.items,
      sections: sections.flatMap((c) => c.items),
      proof: 'single-operation painted cells and literal model column',
    });
  }
  return relationships;
}

/** Open tables require two independently painted row rules plus a repeated
 * label/value seam. A unique literal title above these rows owns this source
 * page, never a filename or model prefix. Largest text gaps are hypotheses only:
 * repeated seams, complete source row bounds and nonoverlap confirm them. A
 * second possible seam with repeated support makes the row ambiguous.
 */
function ruledRelationships(
  layout: PdfSourceLayout,
  target: DocumentQualificationTarget,
): Relationship[] {
  const titles = layout.items.filter((i) => literalIdentity([i], target));
  if (titles.length !== 1) return [];
  const identity = titles[0];
  const rules = layout.rules.filter((r) => r.ink > 0 && r.a[1] === r.b[1] && r.a[1] < identity.y);
  const regions: Region[] = [];
  for (const top of rules) {
    const left = Math.min(top.a[0], top.b[0]),
      right = Math.max(top.a[0], top.b[0]);
    const below = rules
      .filter(
        (r) =>
          r.a[1] < top.a[1] &&
          Math.max(Math.min(r.a[0], r.b[0]), left) < Math.min(Math.max(r.a[0], r.b[0]), right),
      )
      .sort((a, b) => b.a[1] - a.a[1])[0];
    if (!below) continue;
    const l = Math.max(left, Math.min(below.a[0], below.b[0])),
      h = Math.min(right, Math.max(below.a[0], below.b[0]));
    const items = layout.items.filter(
      (i) =>
        i.x >= l - Math.max(top.ink, below.ink) / 2 &&
        i.x + i.width <= h + Math.max(top.ink, below.ink) / 2 &&
        glyphBottom(i) >= below.a[1] - below.ink / 2 &&
        glyphTop(i) <= top.a[1] + top.ink / 2,
    );
    if (items.length && items.every((i) => i.height < identity.height))
      regions.push({
        left: l,
        right: h,
        bottom: below.a[1],
        top: top.a[1],
        items: [...items],
        operators: [top.operator, below.operator],
      });
  }
  const hypotheses = regions.flatMap((region) => {
    const row = [...region.items].sort((a, b) => a.x - b.x || b.y - a.y);
    const widest = Math.max(
      ...row
        .slice(1)
        .map((i, n) => i.x - Math.max(...row.slice(0, n + 1).map((j) => j.x + j.width))),
    );
    return row.slice(1).flatMap((i, n) => {
      const label = row.slice(0, n + 1),
        value = row.slice(n + 1);
      if (
        !/[A-Za-z]/.test(words(label)) ||
        label.some((j) => j.x + j.width >= i.x) ||
        !value.some((j) => sameLine(j, label[0]))
      )
        return [];
      if (i.x - Math.max(...label.map((j) => j.x + j.width)) !== widest) return [];
      if (!label.every((j) => sameLine(j, label[0])) && !value.every((j) => sameLine(j, value[0])))
        return [];
      return [{ region, label, value, seam: i.x }];
    });
  });
  const supported = hypotheses.filter(
    (r) =>
      hypotheses.filter(
        (s) =>
          s.region !== r.region &&
          Math.abs(s.seam - r.seam) <= Math.min(s.value[0].height, r.value[0].height) / 4 &&
          Math.abs(s.label[0].x - r.label[0].x) <=
            Math.min(s.label[0].height, r.label[0].height) / 4,
      ).length >= 2,
  );
  return supported
    .filter((r) => supported.filter((s) => s.region === r.region).length === 1)
    .map((r) => {
      const heading = regions
        .filter(
          (s) =>
            s.top >= r.region.top &&
            s.right > r.label[0].x &&
            s.left < r.value[0].x &&
            s.items.length === 1 &&
            s.items[0].x < r.value[0].x &&
            /[A-Za-z]/.test(s.items[0].text),
        )
        .sort((a, b) => a.bottom - b.bottom)[0];
      return {
        label: r.label,
        value: r.value,
        identity: [identity],
        sections: heading?.items ?? [],
        proof:
          'unique literal page title, painted horizontal row bounds and repeated disjoint label/value seam',
      };
    });
}

/** Layout hypotheses use common glyph intervals, never nearest-y assignment.
 * Confirmation requires literal model ownership, disjoint printed model headers,
 * a persistent label edge, and at least three complete independently repeated
 * rows. Three is a conservative structural operating choice to reject a single
 * coincidence or a two-line caption; it is not a measurement tolerance. Every
 * confirmed row must populate every model column, with no crossing item. Shared
 * spans and partial rows remain provisional instead of borrowing a sibling.
 */
function alignedRelationships(
  layout: PdfSourceLayout,
  target: DocumentQualificationTarget,
): Relationship[] {
  const lines: Item[][] = [];
  for (const i of [...layout.items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const matching = lines.filter((line) => line.every((j) => sameLine(i, j)));
    // An overlapping caption remains outside this row grammar. It must not
    // invalidate a separately bounded table elsewhere on the same page.
    if (matching.length > 1) continue;
    if (matching.length) matching[0].push(i);
    else lines.push([i]);
  }
  const modelLine = lines.filter(
    (line) =>
      line.some((i) => literalIdentity([i], target)) &&
      line.filter((i) => /^[A-Za-z][A-Za-z0-9._-]*\d[A-Za-z0-9._-]*$/.test(i.text)).length >= 2,
  );
  if (modelLine.length !== 1) return [];
  const line = modelLine[0].sort((a, b) => a.x - b.x);
  const headers = line.filter((i) => /^[A-Za-z][A-Za-z0-9._-]*\d[A-Za-z0-9._-]*$/.test(i.text));
  const selected = headers.filter((i) => literalIdentity([i], target));
  if (
    selected.length !== 1 ||
    headers.some((h, n) => n > 0 && headers[n - 1].x + headers[n - 1].width >= h.x)
  )
    return [];
  const first = headers[0];
  const headerLeft = line.filter((i) => i.x + i.width < first.x);
  if (headerLeft.length !== 1) return [];
  const boundaries = headers.slice(1).map((h, n) => (headers[n].x + headers[n].width + h.x) / 2);
  const rows: Relationship[] = [];
  for (const row of lines.filter((r) => r.every((i) => i.y < first.y))) {
    const labels = row.filter((i) => i.x + i.width < first.x);
    const values = row.filter((i) => i.x + i.width >= first.x);
    if (!labels.length || !values.length) continue;
    const labelEdge = Math.max(...labels.map((i) => i.x + i.width));
    const columns = headers.map((h, n) =>
      values.filter(
        (i) =>
          i.x >= (n ? boundaries[n - 1] : labelEdge) &&
          i.x + i.width <= (boundaries[n] ?? Infinity),
      ),
    );
    if (columns.some((c) => !c.length) || columns.flat().length !== values.length) continue;
    if (columns.some((c) => c.some((i, n) => n > 0 && c[n - 1].x + c[n - 1].width > i.x))) continue;
    const label = labels.sort((a, b) => a.x - b.x);
    // A competing group heading on the same line is not a quantity label.
    if (
      label.length > 1 &&
      label.some((i, n) => n > 0 && label[n - 1].x + label[n - 1].width >= i.x)
    )
      continue;
    rows.push({
      label,
      value: columns[headers.indexOf(selected[0])],
      identity: [selected[0]],
      sections: [],
      proof: 'literal model matrix and independently repeated disjoint aligned columns',
    });
  }
  const edge = (r: Relationship) => r.label.at(-1)!.x + r.label.at(-1)!.width;
  // A quarter of the smaller source em admits a label-edge hypothesis despite
  // PDF justification/rounding. This conservative layout heuristic is independent
  // of all value-column boundaries (which must remain disjoint without tolerance).
  // It cannot resolve crossing values or attest a quantity/engineering tolerance.
  const anchored = rows.filter(
    (r) =>
      rows.filter(
        (s) =>
          s.label[0].x === r.label[0].x ||
          Math.abs(edge(s) - edge(r)) <=
            Math.min(s.label.at(-1)!.height, r.label.at(-1)!.height) / 4,
      ).length >= 3,
  );
  if (anchored.length < 3) return [];
  const headings = layout.items
    .filter(
      (i) =>
        i.x < first.x &&
        upperHeading(i.text) &&
        Math.abs(i.x - headerLeft[0].x) <= Math.min(i.height, headerLeft[0].height) / 4,
    )
    .map((i) => [i]);
  const sourceCells = pdfGridCells({
    version: PDF_VECTOR_STRUCTURE,
    items: layout.items,
    rules: layout.rules,
  });
  for (const row of anchored) {
    const section = headings
      .filter((r) => r[0].y >= row.label[0].y && r[0].y <= first.y)
      .sort((a, b) => a[0].y - b[0].y)[0];
    if (section) row.sections.push(...section);
    else if (upperHeading(words(headerLeft)) && !/^(?:models?|products?)$/i.test(words(headerLeft)))
      row.sections.push(...headerLeft);
    const sourceGroups = sourceCells.filter(
      (c) =>
        c.items.length === 1 &&
        c.right <= row.label[0].x &&
        c.bottom <= row.label[0].y &&
        c.top >= row.label[0].y &&
        upperHeading(c.items[0].text),
    );
    for (const group of sourceGroups) row.sections.push(...(group.items as Item[]));
  }
  return anchored;
}

export function qualifyPdfLayout(
  document: DocumentExtractionArtifact,
  block: DocumentBlock,
  target: DocumentQualificationTarget,
): readonly QualifiedFactArtifact[] {
  const layout = readLayout(document, block);
  if (!layout || !document.source_acquisition || document.source_capture.kind !== 'source_capture')
    return [];
  // Rotated drawing annotations stay raw source evidence. They cannot supply an
  // upright table quantity, nor invalidate an independently bounded page column.
  // A rotated anchor inside a proposed row rejects that row conservatively.
  const active = { ...layout, items: layout.items.filter((i) => i.upright) };
  const painted = paintedRelationships(active, target);
  const ruled = painted.length ? [] : ruledRelationships(active, target);
  const aligned = alignedRelationships(active, target);
  const relationships = [
    ...painted,
    ...ruled,
    ...aligned.filter((r) => !painted.some((p) => words(p.label) === words(r.label))),
  ].filter((r) => {
    const row = [...r.label, ...r.value];
    return !layout.items.some(
      (i) =>
        !i.upright &&
        i.x >= Math.min(...row.map((j) => j.x)) &&
        i.x <= Math.max(...row.map((j) => j.x + j.width)) &&
        i.y >= Math.min(...row.map(glyphBottom)) &&
        i.y <= Math.max(...row.map(glyphTop)),
    );
  });
  if (!relationships.length) return [];
  const used = new Set(
    relationships.flatMap((r) => [...r.label, ...r.value, ...r.identity, ...r.sections]),
  );
  // Only actual note markers propose note scope. Other page text is retained in
  // extraction, not appended as an invented engineering condition on every row.
  const notes = layout.items.filter(
    (i) =>
      !used.has(i) &&
      !/^notes?:?$/i.test(i.text) &&
      /^(?:notes?\b|\(?\d+\)[ .]|\d+\.\s|\*)/i.test(i.text),
  );
  const noteGroups = notes.map((note) => {
    const next = notes.filter((i) => i.y < note.y).sort((a, b) => b.y - a.y)[0];
    const items = layout.items.filter(
      (i) =>
        !used.has(i) &&
        i.x >= note.x &&
        i.y <= note.y &&
        i.y > (next?.y ?? -Infinity) &&
        i.height === note.height &&
        (sameLine(i, note) || i.font === note.font),
    );
    // A complete paragraph is bounded by the next explicit note marker. Without
    // another marker only the same printed line is provable; footer prose cannot
    // be silently appended to the final note by vertical proximity.
    if (next) return { note, items };
    const lines = [...new Set(items.map((i) => i.y))].sort((a, b) => b - a);
    const complete: Item[] = [];
    for (const y of lines) {
      const line = items.filter((i) => i.y === y);
      complete.push(...line);
      if (/[.!?]["”']?\)?$/.test(words(line))) return { note, items: complete };
    }
    return { note, items: items.filter((i) => sameLine(i, note)) };
  });
  const ref = artifactReference('document_extraction', document);
  const evidence = (
    role: QualifiedFactEvidence['role'],
    i: Item,
    kind?: 'source_semantic' | 'qualification_provenance' | 'unresolved',
  ): QualifiedFactEvidence => ({
    role,
    text: i.text,
    source_reference: document.source_capture,
    locator: i.location,
    ...(kind ? { context: qualifiedContext(kind, 'document-qualification') } : {}),
  });
  return relationships.flatMap((r, index) => {
    const label = words(r.label),
      value = words(r.value);
    const relevant: Item[] = [],
      unknown: Item[] = [];
    for (const group of noteGroups) {
      const note = words(group.items);
      const number = /^\(?([1-9]\d*)(?:\)|\.)/.exec(note)?.[1];
      const marker = number ? new RegExp(`\\bNote\\.?\\s*${number}\\b`, 'i') : undefined;
      if (/specifications?\s*(?:are\s*)?subject to change/i.test(note)) continue;
      if (
        /(?:all\s+(?:specifications|parameters|ratings)|unless\s+otherwise\s+(?:specified|mentioned))/i.test(
          note,
        )
      )
        relevant.push(...group.items);
      else if (marker && layout.items.some((i) => marker.test(i.text))) {
        if (marker.test(label)) relevant.push(...group.items);
      } else if (
        /^\d+\.\s*The power supply is considered as an independent unit, but the final equipment/i.test(
          note,
        ) &&
        /whole system complies with.*EMC directives/i.test(note)
      ) {
        if (/\bEM[CI]\b/i.test(label)) relevant.push(...group.items);
      } else if (
        /^\d+\.\s*The ambient temperature derating/i.test(note) &&
        /operating altitude higher than/i.test(note) &&
        /\d+\s*m\s*\(/i.test(note)
      ) {
        // Explicit altitude-dependent thermal derating constrains performance,
        // not mechanical dimensions. Preserve the complete statement without
        // inventing a derating calculation or a universal ambient limit.
        if (!/^(?:dimensions?|weight|mass|packing)$/i.test(label)) relevant.push(...group.items);
      } else if (/in the (.+?) section/i.test(note)) {
        const section = /in the (.+?) section/i.exec(note)![1];
        if (
          r.sections.some((s) => s.text.toLowerCase() === section.toLowerCase()) &&
          /power/i.test(label)
        )
          relevant.push(...group.items);
      } else unknown.push(...group.items);
    }
    const base = buildQualifiedFactArtifact({
      source_capture: document.source_capture,
      source_acquisition: document.source_acquisition,
      document_extraction: ref,
      acquisition_candidate_id: document.acquisition_candidate_id,
      metadata: {
        source_wording: label,
        source_label: label,
        raw_value: value,
        raw_identifier: words(r.identity),
        applicability: {
          kind: 'exact_product',
          value: words(r.identity),
          reason: `${PDF_SOURCE_LAYOUT}: ${r.proof}; no SKU attestation`,
        },
        ...(value.match(/\((\d+(?:\.\d+)?\s*(?:seconds?|minutes?|ms))\)$/i)
          ? { duration: value.match(/\((\d+(?:\.\d+)?\s*(?:seconds?|minutes?|ms))\)$/i)![1] }
          : {}),
        ...(unknown.length
          ? { alternative_interpretations: ['Source note scope is unresolved.'] }
          : {}),
      },
      evidence: [
        ...r.identity.map((i) => evidence('subject', i)),
        ...r.identity.map((i) => evidence('applicability', i)),
        ...r.label.map((i) => evidence('label', i)),
        ...r.value.map((i) => evidence('value', i)),
        ...r.sections.map((i) => evidence('qualifier', i, 'source_semantic')),
        ...relevant.map((i) => evidence('qualifier', i, 'source_semantic')),
        // Keep the complete scoped paragraph as well as every original fragment
        // locator. Sorting semantic condition strings must not detach a unit
        // glyph from its number or reorder a wrapped engineering constraint.
        ...noteGroups
          .filter((g) => g.items.length > 1 && g.items.every((i) => relevant.includes(i)))
          .map((g) => ({
            ...evidence('qualifier', g.items[0], 'source_semantic'),
            text: words(g.items),
          })),
        ...unknown.map((i) => evidence('qualifier', i, 'unresolved')),
        {
          role: 'context',
          text: `${PDF_SOURCE_LAYOUT}: ${r.proof}`,
          source_reference: ref,
          locator: { ...block.locator, row: index + 1 },
          context: qualifiedContext('qualification_provenance', 'document-qualification'),
        },
      ],
      qualifier: PDF_SOURCE_LAYOUT,
      qualifier_version: '1.0.0',
      qualification_state: 'structurally_supported',
    });
    // Literal tuple fan-out is source selection, not a calculated dimension or
    // guessed orientation. Consume the entire one-unit tuple and its explicit
    // W/D/H permutation; alternate units, L axes, multipart/installed scopes and
    // incomplete declarations remain the original unsplit qualified evidence.
    const tuple =
      /^(\d+(?:\.\d+)?)\s*[x*×]\s*(\d+(?:\.\d+)?)\s*[x*×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|inch)\s*\(\s*([WDH])\s*[x*×]\s*([WDH])\s*[x*×]\s*([WDH])\s*\)$/i.exec(
        value,
      );
    if (
      !/^dimensions?$/i.test(label) ||
      !tuple ||
      new Set(tuple.slice(5, 8).map((s) => s.toUpperCase())).size !== 3 ||
      r.sections.some((i) => /accessor|shunt|installed|mounting/i.test(i.text))
    )
      return [base];
    const axes: Readonly<Record<string, string>> = { W: 'Width', D: 'Depth', H: 'Height' };
    return [
      base,
      ...tuple.slice(5, 8).map((axis, n) =>
        buildQualifiedFactArtifact({
          ...base,
          source_capture: document.source_capture,
          metadata: {
            ...base.metadata,
            source_label: axes[axis.toUpperCase()],
            source_wording: label,
            raw_value: `${tuple[n + 1]} ${tuple[4]}`,
          },
          evidence: [
            ...(base.evidence ?? []),
            {
              ...evidence('qualifier', r.value[0], 'source_semantic'),
              text: value,
              context: {
                ...qualifiedContext('source_semantic', 'document-qualification'),
                physical_scope: 'product_body',
              },
            },
          ],
        }),
      ),
    ];
  });
}
