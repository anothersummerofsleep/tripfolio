// Best-effort PDF → text. Zero required dependencies: Node's built-in zlib does
// the FlateDecode and feeds the policy-field heuristics in lib/extract-policy.js
// from a text-based insurance schedule.
//
// Deliberately limited, and honest about it: the built-in reader handles
// uncompressed and FlateDecode content streams and pulls strings out of the
// text-showing operators. It does NOT do OCR, custom font CMaps, or the other
// filters (LZW/DCT/JPX…). When the built-in comes up thin (an object-stream PDF,
// an exotic layout) AND poppler's `pdftotext` happens to be installed, we fall
// back to it — an optional enhancement, never a requirement: if it's absent the
// built-in result stands. Either way a scanned/image-only PDF yields '' so the
// caller can fall back to pasted text or the higher-accuracy AI-agent path
// (ingest-policy skill), the same division of labour as the booking importer.

import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// One text object's operators (the span between BT and ET) → the text a human
// would read. We walk it capturing literal `(...)` and hex `<...>` strings
// (what Tj / TJ / ' / " show) and turn the positioning operators into rough
// whitespace so words don't run together.
function textFromRun(content) {
  let out = '';
  let i = 0;
  const n = content.length;
  let inArray = false;

  while (i < n) {
    const c = content[i];

    if (c === '(') {
      // Literal string: honour nested parens and PDF escape sequences.
      i++;
      let depth = 1;
      while (i < n && depth > 0) {
        const ch = content[i];
        if (ch === '\\') {
          const next = content[i + 1];
          if (next === 'n') { out += '\n'; i += 2; }
          else if (next === 't') { out += '\t'; i += 2; }
          else if (next === 'r') { i += 2; }
          else if (next === 'b' || next === 'f') { i += 2; }
          else if (next === '(' || next === ')' || next === '\\') { out += next; i += 2; }
          else if (next >= '0' && next <= '7') {
            let oct = '';
            i++;
            for (let k = 0; k < 3 && content[i] >= '0' && content[i] <= '7'; k++) { oct += content[i]; i++; }
            out += String.fromCharCode(parseInt(oct, 8) & 0xff);
          } else if (next === '\n') { i += 2; } // escaped newline = line continuation
          else if (next === '\r') { i += content[i + 2] === '\n' ? 3 : 2; }
          else { out += next; i += 2; }
        } else if (ch === '(') { depth++; out += ch; i++; }
        else if (ch === ')') { depth--; if (depth > 0) out += ch; i++; }
        else { out += ch; i++; }
      }
    } else if (c === '<' && content[i + 1] !== '<') {
      // Hex string <48656C…>. (`<<` is a dictionary, not a string.)
      const j = content.indexOf('>', i);
      if (j < 0) break;
      const hex = content.slice(i + 1, j).replace(/[^0-9A-Fa-f]/g, '');
      const even = hex.length % 2 ? `${hex}0` : hex;
      for (let k = 0; k < even.length; k += 2) out += String.fromCharCode(parseInt(even.substr(k, 2), 16));
      i = j + 1;
    } else if (c === '[') { inArray = true; i++; }
    else if (c === ']') { inArray = false; i++; }
    else if (inArray && (c === '-' || (c >= '0' && c <= '9'))) {
      // Kerning adjustment inside a TJ array. A large negative shift is how
      // PDFs render an inter-word space, so emit one.
      let num = '';
      while (i < n && /[-0-9.]/.test(content[i])) { num += content[i]; i++; }
      if (parseFloat(num) <= -100) out += ' ';
    } else if (c === 'T' && (content[i + 1] === 'd' || content[i + 1] === 'D' || content[i + 1] === '*')) {
      out += '\n'; // text-positioning move → new line-ish
      i += 2;
    } else { i++; }
  }
  return out;
}

// A whole content stream → its readable text. Only the spans framed by the
// BT / ET text-object operators can show text, so we extract those and ignore
// everything else. This is also what keeps image, ICC-profile, and font
// streams (which decode to binary, never framed by BT…ET) from polluting the
// output — the single most important guard for real-world PDFs.
function textFromContent(content) {
  let out = '';
  let found = false;
  const re = /\bBT\b([\s\S]*?)\bET\b/g;
  let m;
  while ((m = re.exec(content))) {
    found = true;
    out += `${textFromRun(m[1])}\n`;
  }
  return found ? out : '';
}

function normalize(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// A guard against returning mojibake from a PDF whose fonts we can't decode
// (subset/identity-encoded glyphs come out as garbage). Require a handful of
// real word-like runs before we trust the extraction.
function looksLikeText(s) {
  const words = s.match(/[A-Za-z]{2,}/g) || [];
  return words.length >= 5;
}

const wordCount = (s) => (s.match(/[A-Za-z]{2,}/g) || []).length;

// Optional enhancement: poppler's `pdftotext` (mature, robust) when it's on the
// PATH. Best-effort only — any failure (not installed → ENOENT, timeout, bad
// PDF) returns '' and the built-in result stands. `-raw` keeps content order,
// which suits linear field/heuristic scanning better than the column-preserving
// default. pdftotext needs a seekable file, so we stage the bytes in a temp file.
function pdftotextFallback(buf) {
  const bin = process.env.PDFTOTEXT || 'pdftotext';
  const tmp = path.join(os.tmpdir(), `tripfolio-${crypto.randomBytes(6).toString('hex')}.pdf`);
  try {
    fs.writeFileSync(tmp, buf);
    const out = execFileSync(bin, ['-raw', '-q', tmp, '-'], { timeout: 8000, maxBuffer: 32 * 1024 * 1024 });
    return normalize(out.toString('utf8'));
  } catch {
    return '';
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
}

// Public entry point: PDF bytes (Buffer or base64 string) → readable text, or
// '' when nothing usable could be read. Tries the dependency-free built-in
// reader first; only when it comes up thin does it consult pdftotext (if
// present). Never throws on malformed input.
export function pdfToText(input) {
  let buf;
  try {
    buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'base64');
  } catch {
    return '';
  }
  const builtin = extractWithZlib(buf);
  // Built-in did well (a real page's worth of words) — it linearises simple
  // schedules better than pdftotext's column handling, so prefer it.
  if (wordCount(builtin) >= 60) return builtin;
  // Thin result: give pdftotext a shot and keep whichever read more.
  const external = pdftotextFallback(buf);
  return wordCount(external) > wordCount(builtin) ? external : builtin;
}

// The dependency-free reader: FlateDecode/uncompressed content streams via zlib.
function extractWithZlib(buf) {
  const latin1 = buf.toString('latin1');
  const chunks = [];
  const re = /stream\r?\n/g;
  let m;

  while ((m = re.exec(latin1))) {
    const start = m.index + m[0].length;
    const end = latin1.indexOf('endstream', start);
    if (end < 0) continue;

    const dictStart = latin1.lastIndexOf('<<', m.index);
    const dict = dictStart >= 0 ? latin1.slice(dictStart, m.index) : '';
    // Filters we can't handle → skip rather than dumping binary. Images, ICC
    // profiles, fonts and metadata are never text content — skip them too (the
    // BT…ET gate below would catch them anyway, but this avoids the work).
    if (/\/(LZW|DCT|CCITT|JPX|JBIG2|RunLength|ASCII85|ASCIIHex)Decode/.test(dict)) continue;
    if (/\/Subtype\s*\/Image|\/ICCBased|\/Type\s*\/(Font|Metadata)|\/FontFile/.test(dict)) continue;

    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try {
        // Z_SYNC_FLUSH tolerates the trailing EOL/bytes many writers leave
        // between the deflate data and `endstream`.
        data = zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      } catch {
        continue;
      }
    }
    const text = textFromContent(data.toString('latin1'));
    if (text.trim()) chunks.push(text);
  }

  const text = normalize(chunks.join('\n'));
  return looksLikeText(text) ? text : '';
}
