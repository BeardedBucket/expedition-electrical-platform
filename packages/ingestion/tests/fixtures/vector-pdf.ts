import { createHash } from 'node:crypto';
import type { CapturedSource } from '../../src/capture-types.js';

/** Project-authored, source-painted matrix with shared and model-specific cells. */
export function vectorPdfSource(
  options: { sibling?: boolean; ambiguous?: boolean; missingBorder?: boolean; note?: boolean } = {},
): CapturedSource {
  const text = (x: number, y: number, value: string) =>
    `BT /F1 8 Tf 1 0 0 1 ${x} ${y} Tm (${value.replace(/[\\()]/g, '\\$&')}) Tj ET\n`;
  let stream = '0.5 w\n';
  for (const y of [730, 700, 670, 640, 610]) stream += `40 ${y} m 540 ${y} l S\n`;
  for (const x of [40, 240, 390, 540])
    if (!(options.missingBorder && x === 390)) stream += `${x} 610 m ${x} 730 l S\n`;
  stream +=
    text(50, 710, 'Model') +
    text(250, 710, 'EX-42') +
    text(400, 710, options.ambiguous ? 'EX-42' : 'EX-99');
  stream +=
    text(50, 680, 'DC output voltage') +
    text(250, 680, options.sibling ? '48 VDC' : '24 VDC') +
    text(400, 680, '12 VDC');
  stream +=
    text(50, 650, 'Continuous DC power') + text(250, 650, '400 W') + text(400, 650, '900 W');
  stream += text(50, 620, 'Weight') + text(250, 620, '2 kg') + text(400, 620, '5 kg');
  if (options.note) stream += text(40, 590, 'Note: ratings depend on ambient temperature.');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf +=
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
      .join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new TextEncoder().encode(pdf);
  return {
    requested_uri: 'https://example.test/matrix.pdf',
    final_uri: 'https://example.test/matrix.pdf',
    media_type: 'application/pdf',
    response_status: 200,
    retrieved_at: '2026-10-05T00:00:00.000Z',
    body: { bytes },
    content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}
