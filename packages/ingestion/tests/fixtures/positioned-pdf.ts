import { createHash } from 'node:crypto';
import type { CapturedSource } from '../../src/capture-types.js';

/** Project-authored positioned PDF, not a redistributed manufacturer document. */
export function positionedPdfSource(
  options: {
    identity?: string;
    extraIdentity?: boolean;
    thirdColumn?: boolean;
    wrapped?: boolean;
    overlap?: boolean;
    manufacturer?: string;
    tail?: 'label' | 'value';
    footnote?: boolean;
  } = {},
): CapturedSource {
  const escape = (value: string) => value.replace(/[\\()]/g, '\\$&');
  const text = (x: number, y: number, size: number, value: string) =>
    `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escape(value)}) Tj ET\n`;
  const stream =
    text(40, 740, 16, options.manufacturer ?? 'Synthetic Manufacturer') +
    text(40, 720, 12, options.identity ?? 'EX-1 / EX-2') +
    (options.extraIdentity ? text(40, 700, 12, 'OTHER-1 / OTHER-2') : '') +
    text(40, 680, 10, 'Specifications') +
    text(40, 660, 8, 'Continuous current: 5 min.') +
    text(options.overlap ? 41 : 280, 660, 8, '120 A') +
    (options.wrapped ? text(40, 650, 8, 'wrapped label continuation') : '') +
    text(40, 640, 8, 'Maximum voltage') +
    text(280, 640, 8, '24 V') +
    (options.thirdColumn ? text(360, 640, 8, 'unowned third value') : '') +
    (options.tail
      ? text(options.tail === 'label' ? 40 : 280, 620, 8, 'ambiguous continuation')
      : '') +
    text(40, 600, 10, 'Installation') +
    text(40, 580, 8, 'Unstructured instruction prose is not a fact.') +
    (options.footnote
      ? text(40, 560, 8, '*') +
        text(40, 540, 8, 'Ratings depend on the stated installation condition.')
      : '');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new TextEncoder().encode(pdf);
  return {
    requested_uri: 'https://manufacturer.example/instructions.pdf',
    final_uri: 'https://manufacturer.example/instructions.pdf',
    media_type: 'application/pdf',
    response_status: 200,
    retrieved_at: '2026-10-03T00:00:00Z',
    body: { bytes },
    content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}
