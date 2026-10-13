import type { ExtractedBlock } from './capture-types.js';
import type { PositionedPdfItem } from './pdf-positioned-specifications.js';
import type { PdfRule } from './pdf-vector-structure.js';

export const PDF_SOURCE_LAYOUT = 'pdf-source-layout.v1';
// Conservative per-page comparison envelope, intentionally matching v1's
// operational ceiling (not a PDF or engineering limit). Include both record
// dimensions because nested-region comparisons can be quadratic in rules too.
// Reconsider only with measured parser workloads and retained-source regression.
export const PDF_LAYOUT_COMPARISON_BUDGET = 2_000_000;
export interface PdfLayoutItem extends PositionedPdfItem {
  readonly font: string;
  readonly ascent: number;
  readonly descent: number;
}
export interface PdfSourceLayout {
  readonly version: typeof PDF_SOURCE_LAYOUT;
  readonly items: readonly PdfLayoutItem[];
  readonly rules: readonly PdfRule[];
}
export const glyphBottom = (i: PdfLayoutItem) => i.y + i.height * i.descent;
export const glyphTop = (i: PdfLayoutItem) => i.y + i.height * i.ascent;
export const sameLine = (a: PdfLayoutItem, b: PdfLayoutItem) =>
  Math.max(glyphBottom(a), glyphBottom(b)) < Math.min(glyphTop(a), glyphTop(b));

/** Source font ascent/descent establishes glyph intervals, not a coordinate
 * epsilon or an engineering measurement tolerance. Raw baselines remain intact.
 * Keep rules only when their horizontal extent spans at least two source items:
 * single-glyph outlines and empty drawing regions cannot corroborate a table.
 * Rules retain the independently decoded v1 graphics provenance, including its
 * clipping/opacity abstentions. A missing graphics supplement still permits a
 * text-layout hypothesis; it does not manufacture painted boundary proof.
 * Caller owns complete-page and shared text/item budgets and resource cleanup.
 */
export function pdfSourceLayout(
  items: readonly PdfLayoutItem[],
  rules: readonly PdfRule[],
): ExtractedBlock | undefined {
  if (!items.length) return undefined;
  if (items.length * (items.length + rules.length) > PDF_LAYOUT_COMPARISON_BUDGET) return undefined;
  const groups = new Map<number, PdfRule[]>();
  for (const r of rules) groups.set(r.operator, [...(groups.get(r.operator) ?? []), r]);
  const occupied = [...groups.entries()].flatMap(([operator, group]) => {
    if (group.length !== 4) return [];
    const xs = [...new Set(group.flatMap((r) => [r.a[0], r.b[0]]))];
    const ys = [...new Set(group.flatMap((r) => [r.a[1], r.b[1]]))];
    if (xs.length !== 2 || ys.length !== 2) return [];
    const left = Math.min(...xs),
      right = Math.max(...xs),
      bottom = Math.min(...ys),
      top = Math.max(...ys);
    const ink = Math.max(...group.map((r) => r.ink)) / 2;
    const enclosed = items.filter(
      (i) =>
        i.upright &&
        i.x >= left - ink &&
        i.x + i.width <= right + ink &&
        i.y >= bottom - ink &&
        i.y <= top + ink &&
        glyphTop(i) - glyphBottom(i) <= top - bottom + ink * 2,
    );
    return enclosed.length ? [{ operator, left, right, bottom, top, enclosed }] : [];
  });
  if (occupied.length ** 2 > PDF_LAYOUT_COMPARISON_BUDGET) return undefined;
  // Empty and redundant nested backgrounds add no source relationships. Remove
  // them before serialization so ordinary painted tables fit the shared budget.
  const owners = new Set(
    occupied
      .filter(
        (r) =>
          !occupied.some(
            (s) =>
              s !== r &&
              s.left <= r.left &&
              s.right >= r.right &&
              s.bottom <= r.bottom &&
              s.top >= r.top &&
              (s.left < r.left || s.right > r.right || s.bottom < r.bottom || s.top > r.top) &&
              s.enclosed.length === r.enclosed.length &&
              s.enclosed.every((i) => r.enclosed.includes(i)),
          ),
      )
      .map((r) => r.operator),
  );
  for (const r of rules) {
    if (r.ink === 0 || (groups.get(r.operator)?.length ?? 0) > 4) continue;
    if (r.a[0] === r.b[0]) {
      const bottom = Math.min(r.a[1], r.b[1]),
        top = Math.max(r.a[1], r.b[1]);
      if (
        items.filter(
          (i) =>
            i.upright &&
            i.y >= bottom &&
            i.y <= top &&
            Math.min(Math.abs(i.x - r.a[0]), Math.abs(i.x + i.width - r.a[0])) <= i.height,
        ).length >= 3
      )
        owners.add(r.operator);
      continue;
    }
    if (r.a[1] !== r.b[1]) continue;
    const left = Math.min(r.a[0], r.b[0]),
      right = Math.max(r.a[0], r.b[0]);
    if (items.filter((i) => i.upright && i.x >= left && i.x + i.width <= right).length >= 2)
      owners.add(r.operator);
  }
  const kept = rules.filter((r) => owners.has(r.operator));
  if ((items.length + kept.length) ** 2 > PDF_LAYOUT_COMPARISON_BUDGET) return undefined;
  const location = {
    kind: 'pdf' as const,
    page: items[0].location.page,
    section: PDF_SOURCE_LAYOUT,
    fragment: `pdf-page-${items[0].location.page}-source-layout`,
    path: `/pdf/page/${items[0].location.page}/source-layout`,
  };
  return {
    id: location.fragment,
    kind: 'structured',
    text: JSON.stringify({ version: PDF_SOURCE_LAYOUT, items, rules: kept }),
    locator: location,
    source_location: location,
  };
}
