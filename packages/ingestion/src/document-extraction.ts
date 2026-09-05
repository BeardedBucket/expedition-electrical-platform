import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';
import type { CapturedSource, ExtractedBlock, ExtractedDocument } from './capture-types.js';

type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Document = DefaultTreeAdapterTypes.Document;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

const textOf = (node: ChildNode): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(textOf).join(' ') : '';

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();
const element = (node: ChildNode, name: string): node is Element =>
  'tagName' in node && node.tagName === name;

const children = (node: ParentNode, name: string): Element[] =>
  node.childNodes.filter((child): child is Element => element(child, name));

const descendants = (node: ParentNode, name: string): Element[] => {
  const found: Element[] = [];
  walk(node, (child) => {
    if (child.tagName === name) found.push(child);
  });
  return found;
};

const walk = (node: ParentNode, visit: (node: Element) => void): void => {
  for (const child of node.childNodes) {
    if (!('tagName' in child)) continue;
    if (child.tagName === 'script' || child.tagName === 'style' || child.tagName === 'template')
      continue;
    visit(child);
    walk(child, visit);
  }
};

export const extractHtmlDocument = (source: CapturedSource): ExtractedDocument => {
  if (!source.media_type.includes('html')) {
    return {
      source,
      blocks: [],
      warnings: [
        {
          code: 'unsupported_media_type',
          message: `No HTML extractor supports '${source.media_type}'.`,
        },
      ],
    };
  }
  if (source.body.text === undefined) {
    return {
      source,
      blocks: [],
      warnings: [{ code: 'missing_text_body', message: 'HTML extraction requires a text body.' }],
    };
  }
  const document = parse(source.body.text) as Document;
  const blocks: ExtractedBlock[] = [];
  let section: string | undefined;
  let tableNumber = 0;
  let paragraphNumber = 0;
  walk(document, (node) => {
    const tag = node.tagName;
    if (/^h[1-6]$/.test(tag)) {
      const text = clean(textOf(node));
      if (text) {
        section = text;
        blocks.push({
          kind: 'heading',
          text,
          section,
          locator: { fragment: `heading-${blocks.length + 1}`, section },
        });
      }
    } else if (tag === 'p') {
      const text = clean(textOf(node));
      if (text) {
        paragraphNumber += 1;
        blocks.push({
          kind: 'paragraph',
          text,
          section,
          locator: { fragment: `paragraph-${paragraphNumber}`, section },
        });
      }
    } else if (tag === 'table') {
      tableNumber += 1;
      const rows = descendants(node, 'tr')
        .map((row) => {
          const cells = row.childNodes
            .filter((child): child is Element => element(child, 'th') || element(child, 'td'))
            .map((cell) => clean(textOf(cell)));
          return cells.length >= 2
            ? { label: cells[0], value: cells.slice(1).join(' ') }
            : undefined;
        })
        .filter((row): row is { label: string; value: string } => Boolean(row?.label && row.value));
      const text = clean(textOf(node));
      if (text)
        blocks.push({
          kind: 'table',
          text,
          section,
          rows,
          locator: { fragment: `table-${tableNumber}`, table: `table-${tableNumber}`, section },
        });
    } else if (tag === 'dl') {
      const pairs: { label: string; value: string }[] = [];
      const terms = children(node, 'dt');
      for (const term of terms) {
        const siblingIndex = node.childNodes.indexOf(term);
        const definition = node.childNodes
          .slice(siblingIndex + 1)
          .find((child) => element(child, 'dd'));
        if (definition && element(definition, 'dd')) {
          const label = clean(textOf(term));
          const value = clean(textOf(definition));
          if (label && value) pairs.push({ label, value });
        }
      }
      if (pairs.length)
        blocks.push({
          kind: 'definition',
          text: pairs.map((pair) => `${pair.label}: ${pair.value}`).join(' '),
          section,
          rows: pairs,
          locator: { fragment: `definition-${blocks.length + 1}`, section },
        });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = children(node, 'li')
        .map((item) => clean(textOf(item)))
        .filter(Boolean);
      if (items.length)
        blocks.push({
          kind: 'list',
          text: items.join(' '),
          section,
          locator: { fragment: `list-${blocks.length + 1}`, section },
        });
    }
  });
  let title: string | undefined;
  walk(document, (node) => {
    if (node.tagName === 'title' && !title) title = clean(textOf(node));
  });
  return { source, ...(title ? { title } : {}), blocks, warnings: [] };
};

export const extractDocument = (source: CapturedSource): ExtractedDocument => {
  if (source.media_type.includes('html')) return extractHtmlDocument(source);
  return {
    source,
    blocks: [],
    warnings: [
      {
        code:
          source.media_type === 'application/pdf' ? 'pdf_unsupported' : 'unsupported_media_type',
        message:
          source.media_type === 'application/pdf'
            ? 'PDF extraction is not implemented in this phase.'
            : `No extractor supports '${source.media_type}'.`,
      },
    ],
  };
};
