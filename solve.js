// Faster drop-in for csv-reader 1.0.0 (make.fun): run(input) returns exactly
// csv-reader's {columns, rows, errors} for every {text, header}, but reads with
// indexOf jumps + whole-field slices instead of one character at a time.
// Pure: no clock, no randomness, no network, nothing kept between calls.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Result of the field just read.
  let fval = '';
  let fend = END;
  let fadd = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, with `val` already kept and `add`
  // kept characters counted (the quote-junk re-read passes the quoted value).
  // Sets fval / fend / fadd. A CR not followed by LF is dropped (stray_cr).
  // A tight charCodeAt scan beats three indexOf calls per field here: the
  // unbounded indexOf('\r') scan is what made LF-only files slow.
  function unq(val, add) {
    let parts = null;
    let kept = add;
    let seg = pos;
    let p = pos;
    for (;;) {
      while (p < n) {
        const c = text.charCodeAt(p);
        if (c === 44 || c === 10 || c === 13) break;
        p += 1;
      }
      if (p >= n) {
        const tail = text.slice(seg, n);
        fval = val + (parts === null ? tail : parts.join('') + tail);
        kept += n - seg;
        pos = n;
        fend = END;
        fadd = kept;
        return;
      }
      const c = text.charCodeAt(p);
      if (c === 44) {
        const tail = text.slice(seg, p);
        fval = val + (parts === null ? tail : parts.join('') + tail);
        kept += p - seg;
        pos = p + 1;
        fend = COMMA;
        fadd = kept;
        return;
      }
      if (c === 10) {
        const tail = text.slice(seg, p);
        fval = val + (parts === null ? tail : parts.join('') + tail);
        kept += p - seg;
        pos = p + 1;
        line += 1;
        fend = LINE_BREAK;
        fadd = kept;
        return;
      }
      // CR: CRLF ends the record, a lone CR is dropped (stray_cr).
      if (text.charCodeAt(p + 1) === 10) {
        const tail = text.slice(seg, p);
        fval = val + (parts === null ? tail : parts.join('') + tail);
        kept += p - seg;
        pos = p + 2;
        line += 1;
        fend = LINE_BREAK;
        fadd = kept;
        return;
      }
      error('stray_cr');
      if (parts === null) parts = [];
      parts.push(text.slice(seg, p));
      kept += p - seg;
      p += 1;
      seg = p;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fval / fend / fadd.
  function quo() {
    const open = pos;
    const openLine = line;
    let parts = null;
    pos = open + 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // Never closes: literal quote, re-read the rest as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        unq('"', 0);
        return;
      }
      let seg = text.slice(pos, q);
      const ri = seg.indexOf('\r');
      if (ri !== -1 || seg.indexOf('\n') !== -1) {
        // Count the line breaks inside the quotes: each LF once, each lone CR once.
        let nl = 0;
        let k = 0;
        let p;
        while ((p = seg.indexOf('\n', k)) !== -1) { nl += 1; k = p + 1; }
        k = 0;
        while ((p = seg.indexOf('\r', k)) !== -1) {
          if (seg.charCodeAt(p + 1) !== 10) nl += 1;
          k = p + 1;
        }
        line += nl;
        if (ri !== -1) seg = seg.replace(/\r\n?/g, '\n');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one literal quote, keep scanning.
        if (parts === null) parts = [seg, '"'];
        else { parts.push(seg, '"'); }
        pos = q + 2;
        continue;
      }
      fval = parts === null ? seg : parts.join('') + seg;
      pos = q + 1;
      if (pos >= n) {
        fend = END;
        fadd = 0;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fend = COMMA;
        fadd = 0;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fend = LINE_BREAK;
        fadd = 0;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fend = LINE_BREAK;
        fadd = 0;
        return;
      }
      // What follows the closing quote is appended as it stands (quote junk).
      unq(fval, 0);
      if (fadd > 0) error('quote_junk');
      return;
    }
  }

  for (;;) {
    // Lines with no characters are no records (LF or CRLF only).
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        quo();
      } else {
        quoted = false;
        unq('', 0);
      }
      fields.push(fval);
      ended = fend;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
