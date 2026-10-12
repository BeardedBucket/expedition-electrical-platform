import { createHash } from 'node:crypto';
import type { CapturedSource } from '../../src/capture-types.js';

/** Project-authored open/painted technical tables; no third-party PDF material. */
export function layoutPdfSource(
  options: {
    method?: 'aligned' | 'painted' | 'ruled';
    sibling?: boolean;
    duplicate?: boolean;
    missingIdentity?: boolean;
    crossing?: boolean;
    displaced?: boolean;
    note?: 'unknown' | 'general';
    fragments?: boolean;
    quantities?: boolean;
    dimensions?: 'explicit' | 'incomplete';
    wrapped?: boolean;
  } = {},
): CapturedSource {
  const text = (x: number, y: number, s: string, size = 8) =>
    `BT /F1 ${size} Tf 1 0 0 1 ${x} ${y} Tm (${s.replace(/[\\()]/g, '\\$&')}) Tj ET\n`;
  let stream = '0.5 w\n';
  const method = options.method ?? 'aligned';
  if (method === 'painted') {
    for (const y of [700, 670, 640, 610])
      for (const [x, w] of [
        [40, 190],
        [240, 150],
      ])
        stream += `${x} ${y} ${w} 25 re f\n`;
    stream += text(50, 710, 'Device') + text(250, 710, options.missingIdentity ? 'Other' : 'EX-42');
  } else if (method === 'ruled') {
    stream += text(40, 755, options.missingIdentity ? 'Other' : 'EX-42', 16);
    for (const y of [700, 670, 640, 610]) stream += `40 ${y} m 540 ${y} l S\n`;
  } else {
    stream +=
      text(40, 710, 'Model') +
      text(240, 710, options.missingIdentity ? 'Other' : 'EX-42') +
      text(400, 710, options.duplicate ? 'EX-42' : 'EX-99');
  }
  const rows = options.quantities
    ? [
        [0, 'INPUT BATTERY VOLTAGE RANGE', '9.1 - 17 VDC', '18.1 - 34 VDC'],
        [1, 'INVERTER EFFICIENCY (PEAK)', '90%', '91%'],
        [2, 'CONTINUOUS POWER OUTPUT AT 25 C', '2200 VA', '4000 VA'],
      ]
    : [
        [0, 'DC output voltage', options.sibling ? '48 VDC' : '24 VDC', '12 VDC'],
        [1, 'Continuous DC power', '400 W', '900 W'],
        [2, 'Weight', '2 kg', '5 kg'],
      ];
  for (const [n, label, value, other] of rows as [number, string, string, string][]) {
    const y = 680 - n * 30;
    if (options.wrapped && n === 0)
      stream += text(50, y + 5, 'DC output') + text(50, y - 5, 'voltage');
    else if (options.fragments && n === 0)
      stream += text(50, y, 'DC output') + text(95, y, 'voltage');
    else if (options.dimensions && n === 2) stream += text(50, y, 'DIMENSION');
    else stream += text(50, y, label);
    stream += text(
      options.crossing ? 100 : method === 'aligned' ? 240 : 250,
      options.displaced && n === 0 ? y - 15 : y,
      options.dimensions && n === 2
        ? `32*125.2*102mm (${options.dimensions === 'explicit' ? 'W*H*D' : 'W*H'})`
        : value,
    );
    if (method === 'aligned') stream += text(400, y, other);
  }
  if (options.note)
    stream += text(
      40,
      590,
      options.note === 'general'
        ? 'Note: All ratings are specified at ambient temperature 25 C.'
        : 'Note: ratings depend on ambient temperature.',
    );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((o, n) => {
    offsets.push(pdf.length);
    pdf += `${n + 1} 0 obj\n${o}\nendobj\n`;
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
    requested_uri: 'https://example.test/layout.pdf',
    final_uri: 'https://example.test/layout.pdf',
    media_type: 'application/pdf',
    response_status: 200,
    retrieved_at: '2026-10-07T00:00:00.000Z',
    body: { bytes },
    content_hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}
