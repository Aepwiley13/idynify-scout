/**
 * CSV contact import — the pure half (src/utils/csvContactImport.js).
 *
 * Parsing, header mapping, validation, in-file duplicates and the group tag.
 * The Firestore half is covered by csvImportService.test.js.
 */
import { describe, it, expect } from 'vitest';
import {
  parseContactCsv, classifyRows, summarizeRows, normalizeRow, mapHeader,
  buildImportTag, defaultImportName, toIdentityCandidate,
  ROW_STATUS, MAX_IMPORT_ROWS,
} from '../utils/csvContactImport';

const classify = (text, opts) => {
  const p = parseContactCsv(text);
  return classifyRows(p.rows, p.mappedHeaders, opts);
};

describe('parseContactCsv — PapaParse, not split(",")', () => {
  it('keeps a quoted comma inside one field', () => {
    const { rows, mappedHeaders } = parseContactCsv(
      'Name,Company,Email\nAaron Wiley,"Acme, Inc.",aaron@acme.com\n',
    );
    const c = normalizeRow(rows[0].raw, mappedHeaders);
    expect(c.company).toBe('Acme, Inc.');
    expect(c.email).toBe('aaron@acme.com');
  });

  it('handles escaped quotes, CRLF line endings and a UTF-8 BOM', () => {
    const { rows, mappedHeaders, headers } = parseContactCsv(
      '﻿Name,Title\r\n"Jo ""JJ"" Smith",CEO\r\n',
    );
    expect(headers).toEqual(['Name', 'Title']);
    expect(normalizeRow(rows[0].raw, mappedHeaders)).toMatchObject({ name: 'Jo "JJ" Smith', title: 'CEO' });
  });

  it('maps columns by header regardless of their order', () => {
    const a = classify('Email,Last Name,First Name\nx@y.com,Wiley,Aaron\n')[0].contact;
    const b = classify('First Name,Last Name,Email\nAaron,Wiley,x@y.com\n')[0].contact;
    expect(a).toEqual(b);
    expect(a.name).toBe('Aaron Wiley');
  });

  it('tolerates blank cells and short rows (spreadsheets omit trailing blanks)', () => {
    const rows = classify('Name,Email,Phone,Title\nAaron,,,\nBea,bea@x.com\n');
    expect(rows.map(r => r.status)).toEqual([ROW_STATUS.READY, ROW_STATUS.READY]);
    expect(rows[0].contact.email).toBeUndefined();
  });

  it('skips blank lines without shifting the row numbers it reports', () => {
    const rows = classify('Name,Email\nA,a@x.com\n,\n\nB,not-an-email\n');
    expect(rows.map(r => r.rowNumber)).toEqual([2, 5]);
    expect(rows[1].status).toBe(ROW_STATUS.INVALID);
  });

  it('flags a row with more cells than the header instead of importing it shifted', () => {
    const rows = classify('Name,Company,Email\nAaron,Acme, Inc.,aaron@acme.com\n');
    expect(rows[0].status).toBe(ROW_STATUS.INVALID);
    expect(rows[0].reason).toMatch(/unquoted comma/);
  });

  it('reports columns it does not import', () => {
    const p = parseContactCsv('Name,Favorite Color,Email\nA,blue,a@x.com\n');
    expect(p.ignoredHeaders).toEqual(['Favorite Color']);
  });

  it('fails the whole file when no column is a contact field', () => {
    expect(parseContactCsv('foo,bar\n1,2\n').fatal).toMatch(/None of the columns/);
    expect(parseContactCsv('Name,Email\n').fatal).toMatch(/no data rows/);
  });

  it('recognizes common export header spellings', () => {
    expect(mapHeader('First_Name')).toBe('first_name');
    expect(mapHeader('  E-Mail ')).toBe('email');
    expect(mapHeader('Job Title')).toBe('title');
    expect(mapHeader('Vertical')).toBe('industry');
    expect(mapHeader('Person Linkedin Url')).toBe('linkedin_url');
    expect(mapHeader('State/Province')).toBe('state');
    expect(mapHeader('Notes')).toBe('notes');
  });
});

describe('normalizeRow — every supported field survives', () => {
  it('keeps first, last, full name, email, phone, title, company, industry, state, location, LinkedIn and notes', () => {
    const [row] = classify(
      'First Name,Last Name,Email,Phone,Title,Company,Vertical,State,City,LinkedIn URL,Notes\n'
      + 'Aaron,Wiley,AARON@Acme.com,555-123-4567,CEO,"Acme, Inc.",SaaS,UT,Salt Lake City,https://linkedin.com/in/aaron,Met at expo\n',
    );
    expect(row.status).toBe(ROW_STATUS.READY);
    expect(row.contact).toEqual({
      first_name: 'Aaron',
      last_name: 'Wiley',
      name: 'Aaron Wiley',
      email: 'aaron@acme.com',
      phone: '555-123-4567',
      title: 'CEO',
      company: 'Acme, Inc.',
      industry: 'SaaS',
      state: 'UT',
      location: 'Salt Lake City',
      linkedin_url: 'https://linkedin.com/in/aaron',
      notes: 'Met at expo',
    });
  });

  it('derives first/last from a full name', () => {
    expect(classify('Name\nMary Ann Lee\n')[0].contact).toMatchObject({
      name: 'Mary Ann Lee', first_name: 'Mary', last_name: 'Ann Lee',
    });
  });
});

describe('classifyRows — validation', () => {
  it('does not treat an invalid email as importable', () => {
    const [row] = classify('Name,Email\nAaron,aaron@nowhere\n');
    expect(row.status).toBe(ROW_STATUS.INVALID);
    expect(row.reason).toMatch(/Invalid email/);
  });

  it('requires a name or an email', () => {
    const [row] = classify('Name,Title,Email\n,CEO,\n');
    expect(row.status).toBe(ROW_STATUS.MISSING);
  });

  it('accepts an email with no name, and names the person by that email', () => {
    const [row] = classify('Email\nsam@x.com\n');
    expect(row.status).toBe(ROW_STATUS.READY);
    expect(row.contact.name).toBe('sam@x.com');
  });

  it('sets aside a non-LinkedIn URL in the LinkedIn column, with a warning', () => {
    const [row] = classify('Name,LinkedIn\nAaron,https://example.com/aaron\n');
    expect(row.status).toBe(ROW_STATUS.READY);
    expect(row.contact.linkedin_url).toBeUndefined();
    expect(row.warnings[0]).toMatch(/LinkedIn URL ignored/);
  });

  it('reports rows past the import limit rather than dropping them', () => {
    const rows = classify('Email\na@x.com\nb@x.com\nc@x.com\n', { maxRows: 2 });
    expect(rows.map(r => r.status)).toEqual([ROW_STATUS.READY, ROW_STATUS.READY, ROW_STATUS.OVER_LIMIT]);
    expect(rows[2].reason).toMatch(/2-row import limit/);
    expect(MAX_IMPORT_ROWS).toBeGreaterThanOrEqual(50);
  });
});

describe('classifyRows — duplicates inside one file', () => {
  it('catches the same email, case and spacing aside', () => {
    const rows = classify('Name,Email\nAaron,aaron@acme.com\nA. Wiley, Aaron@ACME.com \n');
    expect(rows[1].status).toBe(ROW_STATUS.DUPLICATE_IN_FILE);
    expect(rows[1].duplicateOfRow).toBe(2);
  });

  it('catches the same LinkedIn URL or phone written differently', () => {
    const rows = classify(
      'Name,LinkedIn,Phone\n'
      + 'A,https://www.linkedin.com/in/aaron/,\n'
      + 'B,linkedin.com/in/aaron,\n'
      + 'C,,(801) 555-1234\n'
      + 'D,,801.555.1234\n',
    );
    expect(rows.map(r => r.status)).toEqual([
      ROW_STATUS.READY, ROW_STATUS.DUPLICATE_IN_FILE, ROW_STATUS.READY, ROW_STATUS.DUPLICATE_IN_FILE,
    ]);
  });

  it('does NOT treat a shared name alone as a duplicate (that is a review signal, not identity)', () => {
    const rows = classify('Name,Company\nJohn Smith,Acme\nJohn Smith,Acme\n');
    expect(rows.map(r => r.status)).toEqual([ROW_STATUS.READY, ROW_STATUS.READY]);
  });

  it('summarizes counts per status', () => {
    const rows = classify('Name,Email\nA,a@x.com\nB,a@x.com\n,\nC,bad\n,\n');
    expect(summarizeRows(rows)).toMatchObject({
      [ROW_STATUS.READY]: 1, [ROW_STATUS.DUPLICATE_IN_FILE]: 1, [ROW_STATUS.INVALID]: 1,
    });
  });
});

describe('import grouping', () => {
  it('builds a readable tag from the import name and the local date', () => {
    expect(buildImportTag('Beyond Words', new Date(2026, 9, 2))).toBe('CSV Import - Beyond Words - 2026-10-02');
    expect(buildImportTag('   ', new Date(2026, 0, 5))).toBe('CSV Import - Upload - 2026-01-05');
  });

  it('defaults the import name from the file name', () => {
    expect(defaultImportName('UAC_Contact_Hub.csv')).toBe('UAC Contact Hub');
  });

  it('hands the resolver raw identifiers and the csv_import source', () => {
    expect(toIdentityCandidate({ name: 'A', email: 'a@x.com', company: 'Acme' })).toMatchObject({
      email: 'a@x.com', name: 'A', company: 'Acme', company_name: 'Acme', source: 'csv_import',
    });
  });
});
