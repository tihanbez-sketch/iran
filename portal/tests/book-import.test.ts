import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  deriveAgeBand,
  luhnValid,
  mapColumns,
  normalizeZaPhone,
  parseCsv,
  parsePremiumToCents,
  parseStartDate,
  planImport,
  summarizeImport,
  validateRow,
  type ExistingData,
  type RowResult,
} from '@/lib/book-import';

const AS_OF = new Date('2026-08-05T12:00:00Z');
const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'book-sample.csv'), 'utf8');

/* -------------------------------------------------------------------------- */

describe('parseCsv', () => {
  it('handles quoted fields containing commas', () => {
    const { header, rows } = parseCsv('name,phone\n"Van der Merwe, Anna",0761231234\n');
    expect(header).toEqual(['name', 'phone']);
    expect(rows[0]).toEqual(['Van der Merwe, Anna', '0761231234']);
  });

  it('handles CRLF, BOM and escaped quotes', () => {
    const input = '﻿name,note\r\n"Anna ""AJ"" Smith","line1\nline2"\r\n';
    const { header, rows, errors } = parseCsv(input);
    expect(errors).toEqual([]);
    expect(header[0]).toBe('name');
    expect(rows[0][0]).toBe('Anna "AJ" Smith');
    expect(rows[0][1]).toBe('line1\nline2');
  });

  it('pads short rows and skips blank lines', () => {
    const { rows } = parseCsv('a,b,c\n1,2\n\n3,4,5\n');
    expect(rows).toEqual([
      ['1', '2', ''],
      ['3', '4', '5'],
    ]);
  });

  it('flags an unterminated quote instead of hanging', () => {
    const { errors } = parseCsv('a,b\n"open,2\n');
    expect(errors.some((e) => /unterminated/i.test(e.message))).toBe(true);
  });
});

describe('mapColumns', () => {
  it('maps the fixture header through aliases', () => {
    const { header } = parseCsv(FIXTURE);
    const mapping = mapColumns(header);
    expect(mapping.missing).toEqual([]);
    expect(mapping.indexes.name).toBe(0);
    expect(mapping.indexes.phone).toBe(1);
    expect(mapping.indexes.sa_id).toBe(2);
    expect(mapping.indexes.policy_number).toBe(3);
    expect(mapping.indexes.premium).toBe(4);
    expect(mapping.indexes.start_date).toBe(5);
    expect(mapping.indexes.email).toBe(6);
  });

  it('reports missing required columns', () => {
    const mapping = mapColumns(['Full Name', 'Premium']);
    expect(mapping.missing).toEqual(['phone', 'policy_number']);
  });
});

describe('normalizeZaPhone', () => {
  it.each([
    ['0821234567', '+27821234567', true],
    ['082 123 4567', '+27821234567', true],
    ['(082) 123-4567', '+27821234567', true],
    ['27821234567', '+27821234567', true],
    ['+27821234567', '+27821234567', true],
    ['0311234567', '+27311234567', false], // landline: valid, not mobile
  ])('normalises %s', (raw, e164, mobile) => {
    const result = normalizeZaPhone(raw);
    if (!result.ok) throw new Error(result.reason);
    expect(result.e164).toBe(e164);
    expect(result.mobile).toBe(mobile);
  });

  it.each([['073000'], ['12345'], [''], ['+4477009900'], ['08212345678']])(
    'rejects %s',
    (raw) => {
      expect(normalizeZaPhone(raw).ok).toBe(false);
    },
  );
});

describe('luhnValid + deriveAgeBand', () => {
  // Check digits computed by hand for these three:
  const VALID_1975 = '7501015800089'; // born 1975-01-01 -> 51 -> 50_59
  const VALID_1990 = '9002285012081'; // born 1990-02-28 -> 36 -> 30_39
  const VALID_2005 = '0505050400082'; // born 2005-05-05 -> 21 -> under_30 (century pivot)

  it('validates real check digits and rejects corrupted ones', () => {
    expect(luhnValid(VALID_1975)).toBe(true);
    expect(luhnValid('7501015800085')).toBe(false); // last digit tampered
    expect(luhnValid('750101580008')).toBe(false); // 12 digits
    expect(luhnValid('invalid-id')).toBe(false);
  });

  it('derives bands with the century pivot', () => {
    expect(deriveAgeBand({ saId: VALID_1975 }, AS_OF).ageBand).toBe('50_59');
    expect(deriveAgeBand({ saId: VALID_1990 }, AS_OF).ageBand).toBe('30_39');
    expect(deriveAgeBand({ saId: VALID_2005 }, AS_OF).ageBand).toBe('under_30');
  });

  it('falls back to the age column when the ID fails validation', () => {
    const result = deriveAgeBand({ saId: '1234567890123', age: 44 }, AS_OF);
    expect(result.ageBand).toBe('40_49');
    expect(result.warning).toMatch(/failed validation/i);
  });

  it('returns null with a warning when nothing usable exists', () => {
    expect(deriveAgeBand({ saId: 'garbage' }, AS_OF).ageBand).toBeNull();
    expect(deriveAgeBand({}, AS_OF).ageBand).toBeNull();
  });

  it('never includes the ID in its output', () => {
    const result = deriveAgeBand({ saId: VALID_1975 }, AS_OF);
    expect(JSON.stringify(result)).not.toContain(VALID_1975);
  });
});

describe('parsePremiumToCents', () => {
  it.each([
    ['R250.00', 25000],
    ['R 2,500', 250000], // thousands comma
    ['1,150.00', 115000],
    ['95.50', 9550],
    ['180', 18000],
    ['250,50', 25050], // decimal comma
  ])('parses %s -> %i cents', (raw, cents) => {
    expect(parsePremiumToCents(raw)).toBe(cents);
  });

  it('rejects garbage and negatives', () => {
    expect(parsePremiumToCents('abc')).toBeNull();
    expect(parsePremiumToCents('-50')).toBeNull();
    expect(parsePremiumToCents('')).toBeNull();
  });
});

describe('parseStartDate', () => {
  it.each([
    ['2018-03-01', '2018-03-01'],
    ['2015/11/20', '2015-11-20'],
    ['15/06/2020', '2020-06-15'],
    ['01-02-2024', '2024-02-01'], // DD-MM-YYYY
    ['44927', '2023-01-01'], // Excel serial
  ])('parses %s -> %s', (raw, iso) => {
    expect(parseStartDate(raw)).toBe(iso);
  });

  it('rejects impossible dates', () => {
    expect(parseStartDate('2020-31-02')).toBeNull();
    expect(parseStartDate('31/02/2020')).toBeNull();
    expect(parseStartDate('soon')).toBeNull();
    expect(parseStartDate('')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

function runFixture(): { rows: RowResult[]; report: ReturnType<typeof summarizeImport> } {
  const { header, rows } = parseCsv(FIXTURE);
  const mapping = mapColumns(header);
  const results = rows.map((row, i) => validateRow(row, mapping, i + 2, AS_OF));
  const existing: ExistingData = { leadsByPhone: new Map(), policyKeys: new Set() };
  const plan = planImport(results, existing);
  return { rows: results, report: summarizeImport(plan, results) };
}

describe('the 20-row dirty fixture', () => {
  it('produces the expected plan', () => {
    const { report } = runFixture();
    expect(report.parsed).toBe(20);
    // Rows 9 (short phone), 13 (no name), 14 (no policy number) fail.
    expect(report.errorRows).toBe(3);
    // Row 7 duplicates row 1's phone in-file.
    expect(report.skipped).toBe(1);
    expect(report.creates).toBe(16);
    expect(report.merges).toBe(0);
    expect(report.links).toBe(0);
  });

  it('reports per-row errors with row numbers', () => {
    const { report } = runFixture();
    const numbers = report.rowErrors.map((e) => e.rowNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([10, 14, 15]); // 1-based incl. header: rows 10, 14, 15 of the file
  });

  it('accepts missing emails and flags invalid ones as warnings, not errors', () => {
    const { rows, report } = runFixture();
    const nomsa = rows.find((r) => r.ok && r.lead.fullName === 'Nomsa Dlamini');
    expect(nomsa && nomsa.ok && nomsa.lead.email).toBeNull();
    expect(report.warnings.some((w) => w.warnings.some((x) => /email/i.test(x)))).toBe(true);
  });

  it('keeps the quoted comma name intact', () => {
    const { rows } = runFixture();
    const anna = rows.find((r) => r.ok && /van der merwe/i.test(r.lead.fullName));
    expect(anna && anna.ok && anna.lead.fullName).toBe('Van der Merwe, Anna');
  });

  it('flags the landline as a warning, not a rejection', () => {
    const { rows } = runFixture();
    const hendrik = rows.find((r) => r.ok && r.lead.fullName === 'Hendrik Kruger');
    expect(hendrik?.ok).toBe(true);
    expect(hendrik && hendrik.ok && hendrik.warnings.some((w) => /mobile/i.test(w))).toBe(true);
  });

  it('NEVER lets a 13-digit ID number reach any output — the POPIA assertion', () => {
    const { rows, report } = runFixture();
    const everything = JSON.stringify({ rows, report });
    expect(everything).not.toMatch(/\d{13}/);
  });
});

describe('planImport against existing data', () => {
  it('merges book re-runs and links web leads without touching them', () => {
    const { header, rows } = parseCsv(FIXTURE);
    const mapping = mapColumns(header);
    const results = rows.slice(0, 4).map((row, i) => validateRow(row, mapping, i + 2, AS_OF));

    const existing: ExistingData = {
      leadsByPhone: new Map([
        ['+27821234567', { id: 'book-lead-1', source: 'funeral_book' }], // Thandi: re-run
        ['+27731112222', { id: 'web-lead-1', source: 'retirement_health_score' }], // Nomsa: web lead
      ]),
      policyKeys: new Set(),
    };

    const plan = planImport(results, existing);
    const actions = plan.actions.map((a) => a.action);
    expect(actions).toContain('merge');
    expect(actions).toContain('link');
    expect(actions).toContain('create');

    const merge = plan.actions.find((a) => a.action === 'merge');
    const link = plan.actions.find((a) => a.action === 'link');
    expect(merge && 'leadId' in merge && merge.leadId).toBe('book-lead-1');
    expect(link && 'leadId' in link && link.leadId).toBe('web-lead-1');
  });
});
