import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { pdfToText } from '../lib/pdf-text.js';

// Build a minimal PDF carrying one content stream. Not a fully valid document
// (no xref) — pdfToText only needs the stream/endstream structure and the dict
// filter, which is what we exercise here.
function pdfWith(content, { flate = true } = {}) {
  const body = flate ? zlib.deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  const filter = flate ? ' /Filter /FlateDecode' : '';
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${body.length}${filter} >>\nstream\n`, 'latin1'),
    body,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')
  ]);
}

const SCHEDULE = 'BT /F1 12 Tf 72 720 Td (Insurer: Allianz Global Assistance) Tj '
  + 'T* (Policy Number: TII-99887766) Tj '
  + 'T* [(Overseas) -250 (Medical) -250 (Expenses:) -250 (SGD) -250 (1,000,000)] TJ ET';

test('pdfToText reads a FlateDecode content stream', () => {
  const text = pdfToText(pdfWith(SCHEDULE));
  assert.match(text, /Allianz Global Assistance/);
  assert.match(text, /TII-99887766/);
  // The large negative kerning between array strings becomes inter-word spaces.
  assert.match(text, /Overseas Medical Expenses/);
});

test('pdfToText reads an uncompressed content stream', () => {
  const text = pdfToText(pdfWith(SCHEDULE, { flate: false }));
  assert.match(text, /Allianz Global Assistance/);
});

test('pdfToText accepts a base64 string', () => {
  const b64 = pdfWith(SCHEDULE).toString('base64');
  assert.match(pdfToText(b64), /TII-99887766/);
});

test('pdfToText hex strings decode', () => {
  const phrase = 'Policy Number AX 12345 issued by Allianz';
  const hex = Buffer.from(phrase, 'latin1').toString('hex');
  const text = pdfToText(pdfWith(`BT <${hex}> Tj ET`));
  assert.match(text, /Policy Number AX 12345 issued by Allianz/);
});

test('pdfToText returns empty for non-PDF / unreadable input', () => {
  assert.equal(pdfToText(Buffer.from('not a pdf at all')), '');
  assert.equal(pdfToText('%PDF-1.4 but no streams here'), '');
});

test('pdfToText ignores filters it cannot decode', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /DCTDecode >>\nstream\n\xff\xd8\xff\xe0garbage\nendstream\nendobj', 'latin1');
  assert.equal(pdfToText(pdf), '');
});

test('the pdftotext fallback degrades gracefully when poppler is absent', () => {
  // Point at a binary that does not exist: the built-in result must still stand
  // and nothing may throw. The DCT-only PDF has no built-in text, so this also
  // exercises the fallback path (thin built-in → attempt pdftotext → ENOENT).
  const prev = process.env.PDFTOTEXT;
  process.env.PDFTOTEXT = 'definitely-not-a-real-binary-xyz';
  try {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /DCTDecode >>\nstream\n\xff\xd8\xff\xe0garbage\nendstream\nendobj', 'latin1');
    assert.equal(pdfToText(pdf), '');
    // A good built-in read never even consults the fallback.
    assert.match(pdfToText(pdfWith(SCHEDULE)), /Allianz Global Assistance/);
  } finally {
    if (prev === undefined) delete process.env.PDFTOTEXT; else process.env.PDFTOTEXT = prev;
  }
});
