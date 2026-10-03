import type { ProductIntake, SourceRole } from './production-contracts.js';

/** Acquisition scheduling metadata only; never a confidence or verified fact. */
export interface CapturePriorityInput {
  readonly normalized_uri: string;
  readonly source_label?: string;
  readonly role: SourceRole;
  readonly parent_uri: string;
  readonly depth: 0 | 1;
  readonly manual_document_context?: boolean;
  readonly max_depth: number;
}

export type CapturePriorityClass =
  | 'manual_index'
  | 'technical_specification'
  | 'datasheet'
  | 'installation'
  | 'manual'
  | 'technical_drawing'
  | 'certificate'
  | 'compatibility_firmware'
  | 'support_product'
  | 'generic';

export interface CapturePriority {
  readonly category: CapturePriorityClass;
  readonly product_context: 'resource_identity' | 'parent_identity' | 'not_asserted';
  readonly tuple: readonly [number, number];
}

const tokens = (value: string): string[] => {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A malformed escape is inert text, not an identity assertion.
  }
  return decoded
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
};

const containsIdentity = (value: string, identity: string | undefined): boolean => {
  if (!identity) return false;
  const normalize = (text: string): string => {
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep malformed escapes literal.
    }
    return text
      .toLowerCase()
      .replace(/[-_\s]+/g, ' ')
      .trim();
  };
  const wanted = normalize(identity);
  const present = normalize(value);
  if (!wanted) return false;
  let start = present.indexOf(wanted);
  while (start >= 0) {
    const before = present[start - 1] ?? '';
    const after = present[start + wanted.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    start = present.indexOf(wanted, start + 1);
  }
  return false;
};

export const classifyCapturePriority = (
  input: CapturePriorityInput,
  intake: Pick<ProductIntake, 'product_model' | 'manufacturer_part_number'>,
): CapturePriority => {
  const identifies = (value: string) =>
    containsIdentity(value, intake.product_model) ||
    containsIdentity(value, intake.manufacturer_part_number);
  const productContext =
    identifies(input.normalized_uri) || identifies(input.source_label ?? '')
      ? 'resource_identity'
      : input.depth === 1 && identifies(input.parent_uri)
        ? 'parent_identity'
        : 'not_asserted';
  const path = new URL(input.normalized_uri).pathname;
  // Classify the leaf, not a manual name in a parent directory: a chapter is
  // not itself a manual merely because its containing index has that name.
  const leaf = tokens(path.split('/').at(-1) ?? '').join(' ');
  const label = tokens(input.source_label ?? '').join(' ');
  const wording = `${leaf} ${label}`;
  const concrete = /\.(?:pdf|html?)$/i.test(path);
  const nonDocument = /\.(?:step|stp|dxf|dwg|mp4|webm|mp3|zip)$/i.test(path);
  let category: CapturePriorityClass = 'generic';
  let order = 6;
  if (nonDocument) {
    category = 'generic';
  } else if (
    input.depth === 0 &&
    input.max_depth === 1 &&
    input.manual_document_context &&
    (/^html5?$/.test(label) || /\bindex\b/.test(leaf) || input.role === 'manual') &&
    !/\.pdf$/i.test(path)
  ) {
    category = 'manual_index';
    order = 0;
  } else if (
    !concrete &&
    (input.role === 'support_article' ||
      (!input.manual_document_context &&
        /^(?:datasheets|manuals|certificates|technical information|schematics)$/.test(leaf)))
  ) {
    // Collection navigation is not a concrete technical document merely
    // because its label names datasheets, manuals, or certificates.
    category = 'support_product';
    order = 5;
  } else if (
    /\b(?:specifications?|specs?)\b/.test(wording) ||
    input.role === 'specification_sheet'
  ) {
    category = 'technical_specification';
    order = 1;
  } else if (/\b(?:datasheets?|data sheets?)\b/.test(wording) || input.role === 'datasheet') {
    category = 'datasheet';
    order = 1;
  } else if (/\b(?:installation|install)\b/.test(wording) || input.role === 'installation_manual') {
    category = 'installation';
    order = 2;
  } else if (
    /\b(?:manuals?|user guide|technical guide)\b/.test(wording) ||
    ['manual', 'technical_manual'].includes(input.role)
  ) {
    category = 'manual';
    order = 2;
  } else if (
    /\b(?:dimensions?|dimensional|drawing|dimensiondrawing|cut out|schematics?)\b/.test(wording) ||
    ['technical_drawing', 'dimensional_drawing'].includes(input.role)
  ) {
    category = 'technical_drawing';
    order = 3;
  } else if (/\bcertificat(?:e|es|ion)\b/.test(wording) || input.role === 'certificate') {
    category = 'certificate';
    order = 4;
  } else if (
    /\b(?:firmware|compatibility|compatible)\b/.test(wording) ||
    input.role === 'firmware_document'
  ) {
    category = 'compatibility_firmware';
    order = 4;
  } else if (input.manual_document_context && /\.pdf$/i.test(path)) {
    category = 'manual';
    order = 2;
  } else if (
    /\b(?:support|help|faq|products?)\b/.test(wording) ||
    ['support_article', 'product_page'].includes(input.role)
  ) {
    category = 'support_product';
    order = 5;
  }
  // Scoped technical evidence precedes unscoped technical evidence. Unknown
  // identity is still eligible; support/unknown do not jump this technical tier.
  const tier = order < 5 ? (productContext === 'not_asserted' ? 1 : 0) : order === 5 ? 2 : 3;
  return { category, product_context: productContext, tuple: [tier, order] };
};

export const compareCapturePriorities = (left: CapturePriority, right: CapturePriority): number =>
  left.tuple[0] - right.tuple[0] || left.tuple[1] - right.tuple[1];
