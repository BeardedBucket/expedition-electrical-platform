import type { ExtractedBlock } from './capture-types.js';
import type { PositionedPdfItem } from './pdf-positioned-specifications.js';

export const PDF_VECTOR_STRUCTURE = 'pdf-vector-grid.v1';
type Point = readonly [number, number];
type Matrix = readonly [number, number, number, number, number, number];
export interface PdfRule {
  readonly a: Point;
  readonly b: Point;
  readonly ink: number;
  readonly operator: number;
}
export interface PdfGrid {
  readonly version: typeof PDF_VECTOR_STRUCTURE;
  readonly items: readonly PositionedPdfItem[];
  readonly rules: readonly PdfRule[];
}
interface Graphics {
  matrix: Matrix;
  width: number;
  clipped: boolean;
  clip?: readonly [number, number, number, number];
  strokeVisible?: boolean;
  fillVisible?: boolean;
  dashed?: boolean;
}
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/** PDF.js 5.4's renderer path encoding, not bounding-box inference. Only painted
 * rectilinear subpaths contribute rules. Curved/unknown clips and rotated graphics
 * cannot establish cells; a rectangular clip admits only wholly contained paths.
 * Save/restore owns the CTM, clipping and opacity state. The PDF graphics default
 * line width is one user-space unit (one point under the identity CTM).
 * Stroke ink is source-declared physical width in PDF points, never an empirical
 * alignment tolerance. Filled rectangles contribute their actual four edges.
 * The caller's existing cell budget bounds retained rules; overflow discards the
 * supplement, leaving the ordinary text extraction usable and unqualified.
 */
export function pdfVectorStructure(
  items: readonly PositionedPdfItem[],
  operations: { fnArray: readonly number[]; argsArray: readonly unknown[] },
  ops: Readonly<Record<string, number>>,
  ruleBudget: number,
): ExtractedBlock | undefined {
  if (!items.length) return undefined;
  let state: Graphics = { matrix: [1, 0, 0, 1, 0, 0], width: 1, clipped: false };
  const stack: Graphics[] = [];
  const rules: PdfRule[] = [];
  let clipPath: readonly [number, number, number, number] | undefined;
  let pendingClip = false;
  for (let index = 0; index < operations.fnArray.length; index++) {
    const fn = operations.fnArray[index],
      args = operations.argsArray[index];
    if (fn === ops.save) stack.push({ ...state });
    else if (fn === ops.paintFormXObjectBegin || fn === ops.beginGroup) {
      // These renderer operations also own an implicit save/restore pair.
      // Form/group internals are outside this grammar (including soft masks).
      stack.push({ ...state });
      state = { ...state, clipped: true };
    } else if (fn === ops.restore || fn === ops.paintFormXObjectEnd || fn === ops.endGroup) {
      const saved = stack.pop();
      if (!saved) return undefined;
      state = saved;
    } else if (fn === ops.transform) {
      if (!Array.isArray(args) || args.length !== 6 || !args.every(Number.isFinite))
        return undefined;
      state.matrix = multiply(state.matrix, args as unknown as Matrix);
    } else if (fn === ops.setLineWidth) {
      if (!Array.isArray(args) || !Number.isFinite(args[0]) || args[0] < 0) return undefined;
      state.width = args[0];
    } else if (fn === ops.setDash) {
      // Dash gaps cannot establish continuous cell boundaries. Retaining the
      // renderer's line endpoints as a solid rule would invent missing ink.
      state.dashed = !Array.isArray(args) || !Array.isArray(args[0]) || args[0].length > 0;
    } else if (fn === ops.setGState && Array.isArray(args) && Array.isArray(args[0])) {
      for (const setting of args[0]) {
        if (!Array.isArray(setting)) {
          state.clipped = true;
          break;
        }
        if (setting[0] === 'LW') {
          if (!Number.isFinite(setting[1]) || setting[1] < 0) {
            state.clipped = true;
            break;
          }
          state.width = setting[1];
        } else if (setting[0] === 'CA')
          state.strokeVisible = typeof setting[1] === 'number' && setting[1] > 0;
        else if (setting[0] === 'ca')
          state.fillVisible = typeof setting[1] === 'number' && setting[1] > 0;
        else if (setting[0] === 'SMask' && setting[1]) state.clipped = true;
        else if (setting[0] === 'D')
          state.dashed =
            !Array.isArray(setting[1]) || !Array.isArray(setting[1][0]) || setting[1][0].length > 0;
      }
    } else if (fn === ops.clip || fn === ops.eoClip) {
      // PDF.js schedules clipping before constructPath consumes the path.
      pendingClip = true;
    } else if (fn === ops.constructPath) {
      if (state.clipped) {
        pendingClip = false;
        continue;
      }
      if (!Array.isArray(args) || !Array.isArray(args[1])) {
        if (pendingClip) {
          state.clipped = true;
          pendingClip = false;
        }
        continue;
      }
      const paint = args[0];
      const stroked =
        state.strokeVisible !== false &&
        !state.dashed &&
        [
          ops.stroke,
          ops.closeStroke,
          ops.fillStroke,
          ops.eoFillStroke,
          ops.closeFillStroke,
          ops.closeEOFillStroke,
        ].includes(paint);
      const filled =
        state.fillVisible !== false &&
        [
          ops.fill,
          ops.eoFill,
          ops.fillStroke,
          ops.eoFillStroke,
          ops.closeFillStroke,
          ops.closeEOFillStroke,
        ].includes(paint);
      const m = state.matrix;
      const clipping = paint === ops.endPath;
      clipPath = undefined;
      if (
        (!stroked && !filled && !clipping) ||
        m[1] !== 0 ||
        m[2] !== 0 ||
        m[0] <= 0 ||
        m[3] <= 0
      ) {
        if (pendingClip) {
          state.clipped = true;
          pendingClip = false;
        }
        continue;
      }
      const path = args[1][0];
      // PDF.js workers/test realms can return another realm's Float32Array.
      // Brand checking avoids dropping valid source paths through instanceof.
      if (
        Object.prototype.toString.call(path) !== '[object Float32Array]' &&
        !Array.isArray(path)
      ) {
        if (pendingClip) {
          state.clipped = true;
          pendingClip = false;
        }
        continue;
      }
      let points: Point[] = [],
        curved = false;
      const flush = (closed: boolean) => {
        if (
          points.length > 2 &&
          points[0][0] === points.at(-1)![0] &&
          points[0][1] === points.at(-1)![1]
        ) {
          points.pop();
          closed = true;
        }
        if (!curved && points.length >= 2) {
          const edges = points.slice(1).map((p, i) => [points[i], p] as const);
          if (closed) edges.push([points.at(-1)!, points[0]]);
          const rectilinear = edges.every(([a, b]) => a[0] === b[0] || a[1] === b[1]);
          const rectangle =
            closed &&
            points.length === 4 &&
            new Set(points.map((p) => p[0])).size === 2 &&
            new Set(points.map((p) => p[1])).size === 2;
          if (clipping && rectilinear && rectangle)
            clipPath = [
              Math.min(...points.map((p) => p[0])),
              Math.min(...points.map((p) => p[1])),
              Math.max(...points.map((p) => p[0])),
              Math.max(...points.map((p) => p[1])),
            ];
          const insideClip =
            !state.clip ||
            points.every(
              (p) =>
                p[0] >= state.clip![0] &&
                p[0] <= state.clip![2] &&
                p[1] >= state.clip![1] &&
                p[1] <= state.clip![3],
            );
          if (insideClip && rectilinear && (stroked || (filled && rectangle))) {
            for (const [a, b] of edges) {
              if (a[0] === b[0] && a[1] === b[1]) continue;
              rules.push({
                a,
                b,
                ink: stroked ? (state.width * (a[0] === b[0] ? m[0] : m[3])) / 2 : 0,
                operator: index + 1,
              });
            }
          }
        }
        points = [];
        curved = false;
      };
      for (let cursor = 0; cursor < path.length;) {
        const command = path[cursor++];
        if (command === 0 || command === 1) {
          if (command === 0) flush(false);
          const x = path[cursor++],
            y = path[cursor++];
          if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
          points.push([m[0] * x + m[4], m[3] * y + m[5]]);
        } else if (command === 2) {
          if (cursor + 6 > path.length) return undefined;
          curved = true;
          cursor += 6;
        } else if (command === 3) flush(true);
        else return undefined;
      }
      flush(
        filled || [ops.closeStroke, ops.closeFillStroke, ops.closeEOFillStroke].includes(paint),
      );
      if (pendingClip) {
        if (!clipPath) state.clipped = true;
        else
          state.clip = state.clip
            ? [
                Math.max(state.clip[0], clipPath[0]),
                Math.max(state.clip[1], clipPath[1]),
                Math.min(state.clip[2], clipPath[2]),
                Math.min(state.clip[3], clipPath[3]),
              ]
            : clipPath;
        pendingClip = false;
        clipPath = undefined;
      }
      if (rules.length > ruleBudget) return undefined;
    }
  }
  if (!rules.length || stack.length || pendingClip) return undefined;
  const page = items[0].location.page!;
  const table = `pdf-vector-page-${page}`;
  return {
    id: table,
    kind: 'structured',
    text: JSON.stringify({ version: PDF_VECTOR_STRUCTURE, items, rules } satisfies PdfGrid),
    locator: {
      fragment: table,
      path: `/pdf/page/${page}/vector-grid`,
      page,
      section: PDF_VECTOR_STRUCTURE,
      table,
    },
    source_location: {
      kind: 'pdf',
      path: `/pdf/page/${page}/vector-grid`,
      page,
      section: PDF_VECTOR_STRUCTURE,
      table,
    },
  };
}

export interface PdfCell {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly items: readonly PositionedPdfItem[];
  readonly operators: readonly number[];
}

/** Four source-painted boundaries must enclose the entire text run. The
 * connected boundary coverage includes only its declared stroke ink. Overlapping
 * alternative cells are rejected, rather than selecting the smallest/proximal
 * enclosure. Wrapped text remains in one cell with every original item locator.
 */
export function pdfGridCells(grid: PdfGrid): readonly PdfCell[] {
  // Conservative operational envelope for this initial quadratic placement
  // algorithm (item-rule products plus cell-overlap candidates), not a source
  // correctness tolerance. No production timing evidence establishes a stronger
  // number yet. An indexed implementation should replace this bound when large
  // vector tables require it; raw text/structure remains retained on abstention.
  if (grid.items.length * (grid.rules.length + grid.items.length) > 2_000_000) return [];
  const horizontal = grid.rules.filter((r) => r.a[1] === r.b[1]);
  const vertical = grid.rules.filter((r) => r.a[0] === r.b[0]);
  const cells = new Map<string, PdfCell>();
  for (const item of grid.items) {
    if (!item.upright) continue;
    const crossesX = (r: PdfRule) =>
      Math.min(r.a[0], r.b[0]) - r.ink <= item.x &&
      Math.max(r.a[0], r.b[0]) + r.ink >= item.x + item.width;
    const above = horizontal
      .filter((r) => r.a[1] - r.ink >= item.y + item.height && crossesX(r))
      .sort((a, b) => a.a[1] - b.a[1]);
    const below = horizontal
      .filter((r) => r.a[1] + r.ink <= item.y && crossesX(r))
      .sort((a, b) => b.a[1] - a.a[1]);
    if (!above.length || !below.length) continue;
    const top = above[0],
      bottom = below[0];
    const coversY = (r: PdfRule) =>
      Math.min(r.a[1], r.b[1]) - r.ink <= bottom.a[1] &&
      Math.max(r.a[1], r.b[1]) + r.ink >= top.a[1];
    const lefts = vertical
      .filter((r) => r.a[0] + r.ink <= item.x && coversY(r))
      .sort((a, b) => b.a[0] - a.a[0]);
    const rights = vertical
      .filter((r) => r.a[0] - r.ink >= item.x + item.width && coversY(r))
      .sort((a, b) => a.a[0] - b.a[0]);
    if (!lefts.length || !rights.length) continue;
    const left = lefts[0],
      right = rights[0];
    if (
      [top, bottom].some(
        (r) =>
          Math.min(r.a[0], r.b[0]) - r.ink > left.a[0] ||
          Math.max(r.a[0], r.b[0]) + r.ink < right.a[0],
      )
    )
      continue;
    const key = [left.a[0], right.a[0], bottom.a[1], top.a[1]].join(':');
    if (!cells.has(key))
      cells.set(key, {
        left: left.a[0],
        right: right.a[0],
        bottom: bottom.a[1],
        top: top.a[1],
        items: [],
        operators: [left.operator, right.operator, bottom.operator, top.operator],
      });
  }
  const candidates = [...cells.values()].map((c) => ({
    ...c,
    items: grid.items.filter(
      (i) => i.x >= c.left && i.x + i.width <= c.right && i.y > c.bottom && i.y + i.height < c.top,
    ),
  }));
  // A cell cannot omit an item crossing its boundary; it could be a spanning
  // label/value or a footnote. No partial text gains ownership through clipping.
  return candidates.filter(
    (c) =>
      c.items.length &&
      !grid.items.some(
        (i) =>
          i.y > c.bottom &&
          i.y < c.top &&
          i.x < c.right &&
          i.x + i.width > c.left &&
          !c.items.includes(i),
      ) &&
      !candidates.some((other) => other !== c && c.items.some((i) => other.items.includes(i))),
  );
}

/** Some source matrices have an open top header, but draw the model dividers
 * down through the header into the data grid. An explicit MODEL(S)/PRODUCT row
 * label and overlapping text-height intervals establish that header row. The
 * dividers must contain the full text width/height; their endpoints bound scope.
 * This rule produces header cells only, never quantity rows from open geometry.
 */
export function pdfModelHeaders(grid: PdfGrid): readonly PdfCell[] {
  const tags = grid.items.filter((i) => /^(?:models?|products?)\s*:?$/i.test(i.text));
  const vertical = grid.rules.filter((r) => r.a[0] === r.b[0]);
  const result: PdfCell[] = [];
  for (const tag of tags) {
    const row = grid.items.filter(
      (i) =>
        i.upright && i.x > tag.x + tag.width && i.y < tag.y + tag.height && i.y + i.height > tag.y,
    );
    for (const item of row) {
      const rules = vertical.filter(
        (r) =>
          Math.min(r.a[1], r.b[1]) - r.ink < item.y &&
          Math.max(r.a[1], r.b[1]) + r.ink > item.y + item.height,
      );
      const left = rules.filter((r) => r.a[0] + r.ink < item.x).sort((a, b) => b.a[0] - a.a[0])[0];
      const right = rules
        .filter((r) => r.a[0] - r.ink > item.x + item.width)
        .sort((a, b) => a.a[0] - b.a[0])[0];
      if (!left || !right) continue;
      const top = Math.min(Math.max(left.a[1], left.b[1]), Math.max(right.a[1], right.b[1]));
      if (
        grid.items.some(
          (i) => i !== item && row.includes(i) && i.x < right.a[0] && i.x + i.width > left.a[0],
        )
      )
        continue;
      result.push({
        left: left.a[0],
        right: right.a[0],
        bottom: item.y,
        top,
        items: [tag, item],
        operators: [left.operator, right.operator],
      });
    }
  }
  return result;
}
