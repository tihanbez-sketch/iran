/**
 * Funeral-book import — pure parsing, validation and planning. No I/O.
 *
 * POPIA minimality is enforced by construction: the SA ID number is used
 * transiently inside deriveAgeBand() to compute an age band and IS NEVER PART
 * OF ANY OUTPUT TYPE — not the lead, not warnings, not error reports, not
 * logs. If you find yourself adding it to an interface here, stop.
 *
 * The import is re-runnable: leads are keyed by phone, policies by
 * (policy_number, product_type), campaign membership by (campaign, lead).
 */

export type AgeBand = 'under_30' | '30_39' | '40_49' | '50_59' | '60_plus';

/* -------------------------------------------------------------------------- */
/* CSV parsing — small RFC-4180 reader; no dependency                          */
/* -------------------------------------------------------------------------- */

export interface ParsedCsv {
  header: string[];
  /** Data rows, aligned to header length (short rows padded with ''). */
  rows: string[][];
  errors: Array<{ line: number; message: string }>;
}

export function parseCsv(input: string): ParsedCsv {
  // Strip BOM; normalise newlines inside the state machine (CRLF handled).
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const records: string[][] = [];
  const errors: ParsedCsv['errors'] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;

  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    // Skip fully blank records (trailing newline, stray empty lines).
    if (record.length > 1 || record[0].trim() !== '') records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (field.length === 0) {
        inQuotes = true;
      } else {
        field += ch; // stray quote mid-field: keep literally
      }
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\r') {
      // swallow; the \n (if any) ends the record
      if (text[i + 1] !== '\n') {
        pushRecord();
        line += 1;
      }
    } else if (ch === '\n') {
      pushRecord();
      line += 1;
    } else {
      field += ch;
    }
  }
  if (inQuotes) errors.push({ line, message: 'Unterminated quoted field' });
  if (field.length > 0 || record.length > 0) pushRecord();

  if (records.length === 0) {
    return { header: [], rows: [], errors: [{ line: 1, message: 'File is empty' }] };
  }

  const header = records[0].map((h) => h.trim());
  const width = header.length;
  const rows = records.slice(1).map((r) => {
    const row = r.slice(0, width).map((c) => c.trim());
    while (row.length < width) row.push('');
    return row;
  });

  return { header, rows, errors };
}

/* -------------------------------------------------------------------------- */
/* Column mapping                                                              */
/* -------------------------------------------------------------------------- */

export type CanonicalColumn =
  | 'name'
  | 'phone'
  | 'sa_id'
  | 'age'
  | 'email'
  | 'policy_number'
  | 'premium'
  | 'start_date';

const COLUMN_ALIASES: Record<CanonicalColumn, string[]> = {
  name: ['name', 'fullname', 'fullnames', 'clientname', 'membername', 'customername', 'insured', 'mainmember'],
  phone: ['phone', 'cell', 'cellphone', 'cellnumber', 'cellno', 'mobile', 'mobilenumber', 'msisdn', 'contact', 'contactnumber', 'tel', 'telephone', 'phonenumber'],
  sa_id: ['id', 'idnumber', 'idno', 'said', 'saidnumber', 'identitynumber'],
  age: ['age'],
  email: ['email', 'emailaddress', 'mail'],
  policy_number: ['policy', 'policynumber', 'policyno', 'policynr', 'contractnumber', 'contractno'],
  premium: ['premium', 'monthlypremium', 'premiumamount', 'installment', 'instalment'],
  start_date: ['startdate', 'inception', 'inceptiondate', 'commencementdate', 'datestarted', 'start', 'datecommenced'],
};

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface ColumnMapping {
  /** header index per canonical column, -1 when absent */
  indexes: Record<CanonicalColumn, number>;
  missing: CanonicalColumn[];
}

const REQUIRED_COLUMNS: CanonicalColumn[] = ['name', 'phone', 'policy_number'];

export function mapColumns(header: string[]): ColumnMapping {
  const normalised = header.map(normaliseHeader);
  const indexes = {} as Record<CanonicalColumn, number>;

  for (const canonical of Object.keys(COLUMN_ALIASES) as CanonicalColumn[]) {
    indexes[canonical] = normalised.findIndex((h) => COLUMN_ALIASES[canonical].includes(h));
  }

  const missing = REQUIRED_COLUMNS.filter((c) => indexes[c] === -1);
  return { indexes, missing };
}

/* -------------------------------------------------------------------------- */
/* Field parsers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Strict ZA normalisation — these numbers get dialled, so unlike the lenient
 * web-form regex in validation.ts, ambiguity is a rejection.
 */
export function normalizeZaPhone(
  raw: string,
): { ok: true; e164: string; mobile: boolean } | { ok: false; reason: string } {
  const digits = raw.replace(/[\s().-]/g, '');
  if (digits.length === 0) return { ok: false, reason: 'Phone number missing' };

  let national: string | null = null;
  if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^27\d{9}$/.test(digits)) national = digits.slice(2);
  else if (/^\+27\d{9}$/.test(digits)) national = digits.slice(3);

  if (!national) return { ok: false, reason: `Not a valid South African number: ${raw}` };

  // 6x/7x/8x are mobile ranges; anything else is dialable but can't receive
  // SMS/WhatsApp — a warning, not a rejection.
  const mobile = /^[678]/.test(national);
  return { ok: true, e164: `+27${national}`, mobile };
}

/** Standard Luhn over the full 13-digit SA ID (last digit is the check). */
export function luhnValid(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i += 1) {
    let d = id.charCodeAt(12 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function bandForAge(age: number): AgeBand {
  if (age < 30) return 'under_30';
  if (age < 40) return '30_39';
  if (age < 50) return '40_49';
  if (age < 60) return '50_59';
  return '60_plus';
}

/**
 * Derives an age band from an SA ID (preferred) or a plain age. The ID is
 * consumed here and discarded — the return type carries only the band.
 */
export function deriveAgeBand(
  input: { saId?: string; age?: number | null },
  asOf: Date,
): { ageBand: AgeBand | null; warning?: string } {
  const saId = input.saId?.replace(/\s/g, '') ?? '';

  if (saId.length > 0) {
    if (!luhnValid(saId)) {
      // Fall through to the age column if present.
      if (input.age != null && Number.isFinite(input.age) && input.age > 0 && input.age < 120) {
        return { ageBand: bandForAge(input.age), warning: 'ID number failed validation; used the age column' };
      }
      return { ageBand: null, warning: 'ID number failed validation' };
    }

    const yy = Number(saId.slice(0, 2));
    const mm = Number(saId.slice(2, 4));
    const dd = Number(saId.slice(4, 6));
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
      return { ageBand: null, warning: 'ID number has an invalid birth date' };
    }

    // Century pivot on the current two-digit year: 26 -> 2026.
    const currentYY = asOf.getFullYear() % 100;
    const century = yy <= currentYY ? 2000 : 1900;
    const birth = new Date(Date.UTC(century + yy, mm - 1, dd));

    let age = asOf.getUTCFullYear() - birth.getUTCFullYear();
    const beforeBirthday =
      asOf.getUTCMonth() < birth.getUTCMonth() ||
      (asOf.getUTCMonth() === birth.getUTCMonth() && asOf.getUTCDate() < birth.getUTCDate());
    if (beforeBirthday) age -= 1;

    if (age < 18) {
      return { ageBand: bandForAge(age), warning: 'Derived age is under 18 — check this row' };
    }
    return { ageBand: bandForAge(age) };
  }

  if (input.age != null && Number.isFinite(input.age) && input.age > 0 && input.age < 120) {
    return { ageBand: bandForAge(input.age) };
  }

  return { ageBand: null };
}

/** "R 250.50" -> 25050. Comma is decimal only when followed by exactly 2 digits. */
export function parsePremiumToCents(raw: string): number | null {
  const cleaned = raw.replace(/[Rr\s]/g, '');
  if (cleaned.length === 0) return null;

  let normalised = cleaned;
  const decimalComma = /^\d{1,3}(?:\d*)?,\d{2}$/.test(cleaned);
  if (decimalComma) {
    normalised = cleaned.replace(',', '.');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }

  const value = Number(normalised);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Accepts ISO, DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD and Excel serials. */
export function parseStartDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));

  // Excel serial (days since 1899-12-30), plausible policy-date range only.
  if (/^\d{4,6}$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (serial >= 20000 && serial <= 60000) {
      const epoch = Date.UTC(1899, 11, 30);
      const date = new Date(epoch + serial * 24 * 60 * 60 * 1000);
      return date.toISOString().slice(0, 10);
    }
  }

  return null;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null; // e.g. 31 February
  }
  return date.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Row validation                                                              */
/* -------------------------------------------------------------------------- */

export interface ImportLead {
  fullName: string;
  phoneE164: string;
  email: string | null;
  ageBand: AgeBand | null;
}

export interface ImportPolicy {
  policyNumber: string;
  premiumCents: number | null;
  startDate: string | null;
}

export type RowResult =
  | { ok: true; rowNumber: number; lead: ImportLead; policy: ImportPolicy; warnings: string[] }
  | { ok: false; rowNumber: number; errors: string[] };

export function validateRow(
  row: string[],
  mapping: ColumnMapping,
  rowNumber: number,
  asOf: Date,
): RowResult {
  const get = (c: CanonicalColumn) => (mapping.indexes[c] >= 0 ? row[mapping.indexes[c]] : '');
  const errors: string[] = [];
  const warnings: string[] = [];

  const fullName = get('name').replace(/\s+/g, ' ').trim();
  if (fullName.length < 2) errors.push('Name is missing');

  const phoneResult = normalizeZaPhone(get('phone'));
  if (!phoneResult.ok) {
    errors.push(phoneResult.reason);
  } else if (!phoneResult.mobile) {
    warnings.push('Not a mobile number — dialable, but no SMS or WhatsApp');
  }

  const policyNumber = get('policy_number').trim();
  if (policyNumber.length === 0) errors.push('Policy number is missing');

  if (errors.length > 0) return { ok: false, rowNumber, errors };

  const ageRaw = get('age').trim();
  const derived = deriveAgeBand(
    { saId: get('sa_id'), age: ageRaw ? Number(ageRaw) : null },
    asOf,
  );
  if (derived.warning) warnings.push(derived.warning);

  const emailRaw = get('email').trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
  if (emailRaw.length > 0 && email === null) warnings.push('Email looks invalid; imported without one');

  const premiumRaw = get('premium').trim();
  const premiumCents = premiumRaw ? parsePremiumToCents(premiumRaw) : null;
  if (premiumRaw && premiumCents === null) warnings.push('Premium could not be read');

  const startRaw = get('start_date').trim();
  const startDate = startRaw ? parseStartDate(startRaw) : null;
  if (startRaw && startDate === null) warnings.push('Start date could not be read');

  return {
    ok: true,
    rowNumber,
    lead: {
      fullName,
      phoneE164: (phoneResult as { e164: string }).e164,
      email,
      ageBand: derived.ageBand,
    },
    policy: { policyNumber, premiumCents, startDate },
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Import planning                                                             */
/* -------------------------------------------------------------------------- */

export interface ExistingLead {
  id: string;
  source: string;
}

export interface ExistingData {
  /** phone (E.164) -> existing lead */
  leadsByPhone: Map<string, ExistingLead>;
  /** `${policyNumber}::${productType}` keys already in the database */
  policyKeys: Set<string>;
}

export type PlannedAction =
  | { action: 'create'; row: Extract<RowResult, { ok: true }> }
  | { action: 'merge'; row: Extract<RowResult, { ok: true }>; leadId: string }
  | { action: 'link'; row: Extract<RowResult, { ok: true }>; leadId: string }
  | { action: 'skip'; rowNumber: number; reason: string };

export interface ImportPlan {
  actions: PlannedAction[];
  errors: Array<{ rowNumber: number; errors: string[] }>;
}

export function planImport(rows: RowResult[], existing: ExistingData): ImportPlan {
  const actions: PlannedAction[] = [];
  const errors: ImportPlan['errors'] = [];
  const seenPhones = new Set<string>();

  for (const row of rows) {
    if (!row.ok) {
      errors.push({ rowNumber: row.rowNumber, errors: row.errors });
      continue;
    }

    const phone = row.lead.phoneE164;
    if (seenPhones.has(phone)) {
      actions.push({
        action: 'skip',
        rowNumber: row.rowNumber,
        reason: `Duplicate phone in file (${phone}) — first occurrence kept`,
      });
      continue;
    }
    seenPhones.add(phone);

    const match = existing.leadsByPhone.get(phone);
    if (!match) {
      actions.push({ action: 'create', row });
    } else if (match.source === 'funeral_book') {
      // Re-run: refresh the policy, keep the lead, never touch consent columns.
      actions.push({ action: 'merge', row, leadId: match.id });
    } else {
      // A web lead who is also a policyholder: attach the policy, flag for
      // review, do not overwrite their web consent or attribution.
      actions.push({ action: 'link', row, leadId: match.id });
    }
  }

  return { actions, errors };
}

export interface ImportReport {
  parsed: number;
  creates: number;
  merges: number;
  links: number;
  skipped: number;
  errorRows: number;
  warnings: Array<{ rowNumber: number; warnings: string[] }>;
  rowErrors: Array<{ rowNumber: number; errors: string[] }>;
  skippedRows: Array<{ rowNumber: number; reason: string }>;
}

export function summarizeImport(plan: ImportPlan, rows: RowResult[]): ImportReport {
  const warnings = rows
    .filter((r): r is Extract<RowResult, { ok: true }> => r.ok && r.warnings.length > 0)
    .map((r) => ({ rowNumber: r.rowNumber, warnings: r.warnings }));

  return {
    parsed: rows.length,
    creates: plan.actions.filter((a) => a.action === 'create').length,
    merges: plan.actions.filter((a) => a.action === 'merge').length,
    links: plan.actions.filter((a) => a.action === 'link').length,
    skipped: plan.actions.filter((a) => a.action === 'skip').length,
    errorRows: plan.errors.length,
    warnings,
    rowErrors: plan.errors,
    skippedRows: plan.actions.flatMap((a) =>
      a.action === 'skip' ? [{ rowNumber: a.rowNumber, reason: a.reason }] : [],
    ),
  };
}
