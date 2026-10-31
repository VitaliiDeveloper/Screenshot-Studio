// SPDX-License-Identifier: Apache-2.0

/** RFC 4180 writer: CRLF record separators, quotes only where a field needs them. */
export function formatCsv(records: readonly (readonly string[])[]): string {
  const field = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return records.map((record) => `${record.map(field).join(",")}\r\n`).join("");
}

/**
 * RFC 4180 reader that also accepts bare LF/CR record separators and a leading byte-order mark
 * (spreadsheets add one on save). Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;
  let afterQuote = false;
  let started = false;

  const endField = () => {
    record.push(value);
    value = "";
    quoted = false;
    afterQuote = false;
  };
  const endRecord = () => {
    if (started) {
      endField();
      records.push(record);
    }
    record = [];
    started = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char !== '"') value += char;
      else if (input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = false;
        afterQuote = true;
      }
      continue;
    }
    if (char === '"') {
      if (value !== "" || afterQuote) throw new Error(`CSV has a stray quote in record ${records.length + 1}`);
      quoted = true;
      started = true;
    } else if (char === ",") {
      started = true;
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      endRecord();
    } else {
      if (afterQuote) throw new Error(`CSV has text after a closing quote in record ${records.length + 1}`);
      value += char;
      started = true;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  endRecord();
  return records;
}
