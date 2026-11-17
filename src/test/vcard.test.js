/**
 * vCard text: the Scout download as it has always been, and My Card's own
 * builder, which may only ever carry what the public view of the card allows.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  escapeVCardText, buildContactVCard, buildMyCardVCard, myCardVCardFileName, downloadVCard,
} from '../utils/vcard';
import { SHAREABLE_FIELDS } from '../pages/ContactHub/cardRules';

const CRLF = '\r\n';
const linesOf = (text) => text.split(CRLF);
/** The content lines with folded continuations joined back on. */
const unfold = (text) => text.replace(/\r\n /g, '');

describe('escapeVCardText', () => {
  it('escapes backslash first, then semicolon, comma and line breaks', () => {
    expect(escapeVCardText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    expect(escapeVCardText('one\ntwo')).toBe('one\\ntwo');
    expect(escapeVCardText('one\r\ntwo\rthree')).toBe('one\\ntwo\\nthree');
  });

  it('cannot be made to end its line or start a field', () => {
    const escaped = escapeVCardText('x\r\nEND:VCARD\r\nBEGIN:VCARD');
    expect(escaped).not.toMatch(/[\r\n]/);
  });

  it('drops control characters and treats missing as empty', () => {
    expect(escapeVCardText('a\u0000b\u0007c')).toBe('abc');
    expect(escapeVCardText(null)).toBe('');
    expect(escapeVCardText(undefined)).toBe('');
    expect(escapeVCardText(42)).toBe('42');
  });
});

describe('Scout contacts (existing behavior)', () => {
  const contact = {
    name: 'Ada Augusta Lovelace',
    company_name: 'Analytical Engines',
    title: 'Analyst',
    work_email: 'ada@example.com',
    email: 'personal@example.com',
    phone_mobile: '555-0100',
    phone_direct: '555-0101',
    phone_work: '555-0102',
    phone: '555-0103',
    linkedin_url: 'https://www.linkedin.com/in/ada',
    source: 'apollo',
  };

  it('writes the same fields in the same order as before', () => {
    expect(buildContactVCard(contact)).toBe([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Lovelace;Ada;Augusta;;',
      'FN:Ada Augusta Lovelace',
      'ORG:Analytical Engines',
      'TITLE:Analyst',
      'EMAIL;TYPE=WORK:ada@example.com',
      'TEL;TYPE=CELL:555-0100',
      'TEL;TYPE=WORK,VOICE:555-0101',
      'URL;TYPE=LINKEDIN:https://www.linkedin.com/in/ada',
      'NOTE:Source: Found via Search',
      'END:VCARD',
      '',
    ].join(CRLF));
  });

  it('keeps the fallbacks: company, email, and a lone phone', () => {
    const text = buildContactVCard({ name: 'Grace Hopper', company: 'Navy', email: 'g@example.com', phone: '555-0199', source: 'manual' });
    expect(linesOf(text)).toEqual([
      'BEGIN:VCARD', 'VERSION:3.0',
      'N:Hopper;Grace;;;', 'FN:Grace Hopper', 'ORG:Navy',
      'EMAIL;TYPE=WORK:g@example.com', 'TEL;TYPE=VOICE:555-0199',
      'NOTE:Source: Added Manually', 'END:VCARD', '',
    ]);
  });

  it('uses work phone only when there is no direct line', () => {
    expect(buildContactVCard({ name: 'A B', phone_work: '1' })).toContain('TEL;TYPE=WORK:1');
    expect(buildContactVCard({ name: 'A B', phone_work: '1', phone_direct: '2' })).not.toContain('TEL;TYPE=WORK:1');
  });

  it('writes a one-word name and an unknown source as given', () => {
    const text = buildContactVCard({ name: 'Cher', source: 'Referral' });
    expect(text).toContain('N:;Cher;;;');
    expect(text).toContain('NOTE:Source: Referral');
  });

  it('is still a valid card with nothing in it', () => {
    expect(buildContactVCard({})).toBe(['BEGIN:VCARD', 'VERSION:3.0', 'END:VCARD', ''].join(CRLF));
  });

  it('escapes special characters in values', () => {
    const text = buildContactVCard({ name: 'Ada Lovelace', company_name: 'Smith, Jones; & Co\\Sons', title: 'Head\nof Things' });
    expect(text).toContain('ORG:Smith\\, Jones\\; & Co\\\\Sons');
    expect(text).toContain('TITLE:Head\\nof Things');
  });

  it('folds a long line at 75 bytes and unfolds back to the original', () => {
    const title = 'Director of '.repeat(20).trim();
    const text = buildContactVCard({ name: 'Ada Lovelace', title });
    for (const line of linesOf(text)) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(text)).toContain(`TITLE:${title}`);
  });
});

describe('downloadVCard (the Scout download)', () => {
  afterEach(() => vi.restoreAllMocks());

  const run = async (contact) => {
    let blob;
    window.URL.createObjectURL = vi.fn((b) => { blob = b; return 'blob:test'; });
    window.URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    downloadVCard(contact);
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    return { text, blob, click };
  };

  it('downloads the built card as a .vcf named for the contact', async () => {
    const contact = { name: 'Ada Lovelace', email: 'ada@example.com' };
    const { text, blob, click } = await run(contact);
    expect(text).toBe(buildContactVCard(contact));
    expect(blob.type).toBe('text/vcard;charset=utf-8');
    expect(click).toHaveBeenCalledTimes(1);
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('names the file from the contact, or "contact" when there is no name', async () => {
    const named = vi.spyOn(document.body, 'appendChild');
    await run({ name: 'Ada  Augusta Lovelace' });
    expect(named.mock.calls[0][0].download).toBe('Ada_Augusta_Lovelace.vcf');
    named.mockClear();
    await run({ email: 'x@example.com' });
    expect(named.mock.calls[0][0].download).toBe('contact.vcf');
  });
});

describe('My Card', () => {
  const ALL_ON = Object.fromEntries(SHAREABLE_FIELDS.map((field) => [field, true]));
  const card = (extra = {}) => ({
    firstName: 'Ada',
    lastName: 'Lovelace',
    photoUrl: 'https://images.example.com/ada.jpg',
    title: 'Analyst',
    organization: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+1 (555) 010-2000',
    linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
    instagram: 'ada.l',
    website: 'https://ada.example.com/',
    share: { ...ALL_ON },
    sharingEnabled: true,
    ...extra,
  });

  it('writes every approved field of a fully shared card', () => {
    expect(buildMyCardVCard(card())).toBe([
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Lovelace;Ada;;;',
      'FN:Ada Lovelace',
      'ORG:Analytical Engines',
      'TITLE:Analyst',
      'EMAIL;TYPE=INTERNET:ada@example.com',
      'TEL;TYPE=VOICE:+1 (555) 010-2000',
      'URL:https://ada.example.com/',
      'URL;TYPE=LinkedIn:https://www.linkedin.com/in/ada-lovelace',
      'URL;TYPE=Instagram:https://www.instagram.com/ada.l',
      'PHOTO;VALUE=uri:https://images.example.com/ada.jpg',
      'END:VCARD',
      '',
    ].join(CRLF));
  });

  it('leaves out each field whose switch is off, and only that field', () => {
    const probes = {
      photoUrl: 'PHOTO', title: 'TITLE', organization: 'ORG', email: 'EMAIL', phone: 'TEL',
      linkedinUrl: 'linkedin.com', instagram: 'instagram.com', website: 'ada.example.com',
    };
    for (const field of SHAREABLE_FIELDS) {
      const text = buildMyCardVCard(card({ share: { ...ALL_ON, [field]: false } }));
      expect(text, field).not.toContain(probes[field]);
      for (const other of SHAREABLE_FIELDS.filter((f) => f !== field)) expect(text, `${field}/${other}`).toContain(probes[other]);
    }
  });

  it('keeps a new card\'s private email, phone, Instagram and website out', () => {
    const text = buildMyCardVCard(card({ share: { photoUrl: true, title: true, organization: true, linkedinUrl: true } }));
    expect(text).not.toMatch(/ada@example\.com|555|instagram|ada\.example\.com/i);
    expect(text).toContain('linkedin.com/in/ada-lovelace');
  });

  it('shares only the name for a card with no switches', () => {
    const { share, ...noSwitches } = card();
    expect(share).toBeDefined();
    expect(linesOf(buildMyCardVCard(noSwitches))).toEqual([
      'BEGIN:VCARD', 'VERSION:3.0', 'N:Lovelace;Ada;;;', 'FN:Ada Lovelace', 'END:VCARD', '',
    ]);
  });

  it('never carries internal metadata, notes or source', () => {
    const text = buildMyCardVCard(card({
      uid: 'u-123', createdAt: 99, notes: 'secret note', source: 'apollo', homeAddress: '1 Main St', _token: 'tok',
    }));
    expect(text).not.toMatch(/u-123|secret|apollo|Main St|tok|NOTE|Source|share|sharingEnabled|schemaVersion/);
    expect(text).not.toContain('NOTE');
  });

  it('writes a card for one part of a name', () => {
    expect(linesOf(buildMyCardVCard({ firstName: 'Cher' })).slice(2, 4)).toEqual(['N:;Cher;;;', 'FN:Cher']);
    expect(linesOf(buildMyCardVCard({ lastName: 'Lovelace' })).slice(2, 4)).toEqual(['N:Lovelace;;;;', 'FN:Lovelace']);
  });

  it('writes nothing for a card with no name, or no card', () => {
    expect(buildMyCardVCard(card({ firstName: '', lastName: '' }))).toBeNull();
    for (const bad of [null, undefined, '', 'Ada', 7, [], {}]) expect(buildMyCardVCard(bad)).toBeNull();
  });

  it('escapes special characters in names, titles and organizations', () => {
    const text = buildMyCardVCard(card({
      firstName: 'Ada; Countess', lastName: 'Lovelace, of Lovelace', organization: 'Smith, Jones; & Co\\Sons', title: 'Head\nof Things',
    }));
    const lines = linesOf(text);
    expect(lines).toContain('N:Lovelace\\, of Lovelace;Ada\\; Countess;;;');
    expect(lines).toContain('FN:Ada\\; Countess Lovelace\\, of Lovelace');
    expect(lines).toContain('ORG:Smith\\, Jones\\; & Co\\\\Sons');
    // A line break in the title is tidied to a space before it gets here.
    expect(lines).toContain('TITLE:Head of Things');
  });

  it('cannot be made to start a new field from a value', () => {
    const text = buildMyCardVCard(card({ title: 'x\r\nEND:VCARD\r\nBEGIN:VCARD\r\nEMAIL:evil@example.com', share: { ...ALL_ON, email: false } }));
    // The injected text stays inside the TITLE line as plain text.
    const lines = linesOf(unfold(text));
    expect(lines.filter((line) => line === 'BEGIN:VCARD')).toHaveLength(1);
    expect(lines.filter((line) => line === 'END:VCARD')).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('EMAIL'))).toEqual([]);
    expect(lines.filter((line) => line.startsWith('TITLE:x'))).toHaveLength(1);
  });

  it('keeps accented and non-Latin names whole', () => {
    const text = buildMyCardVCard(card({ firstName: 'José', lastName: '李', organization: 'Café Ünïcode' }));
    expect(text).toContain('N:李;José;;;');
    expect(text).toContain('ORG:Café Ünïcode');
  });

  it('writes LinkedIn in its one stored form, whatever was typed', () => {
    const text = buildMyCardVCard(card({ linkedinUrl: 'uk.linkedin.com/in/ada-lovelace/?trk=abc' }));
    expect(text).toContain('URL;TYPE=LinkedIn:https://www.linkedin.com/in/ada-lovelace\r\n');
  });

  it('writes Instagram as a profile link, from a name or a pasted link', () => {
    for (const typed of ['@ada.l', 'ada.l', 'https://instagram.com/ada.l/']) {
      expect(buildMyCardVCard(card({ instagram: typed }))).toContain('URL;TYPE=Instagram:https://www.instagram.com/ada.l\r\n');
    }
  });

  it('leaves out profile links that are not real profiles', () => {
    const text = buildMyCardVCard(card({
      linkedinUrl: 'https://evil.example.com/in/ada', instagram: 'https://www.instagram.com/p/abc', website: 'javascript:alert(1)',
    }));
    expect(text).not.toMatch(/URL/);
  });

  it('writes a website with https added when it was typed bare', () => {
    expect(buildMyCardVCard(card({ website: 'ada.example.com' }))).toContain('URL:https://ada.example.com/\r\n');
  });

  it('leaves out a photo that is not an https link', () => {
    expect(buildMyCardVCard(card({ photoUrl: 'data:image/png;base64,AAAA' }))).not.toContain('PHOTO');
    expect(buildMyCardVCard(card({ photoUrl: 'http://images.example.com/a.jpg' }))).not.toContain('PHOTO');
  });

  it('is valid vCard 3.0 framing with a trailing line break and no line over 75 bytes', () => {
    const long = buildMyCardVCard(card({ photoUrl: `https://images.example.com/${'a'.repeat(300)}.jpg` }));
    expect(long.startsWith(`BEGIN:VCARD${CRLF}VERSION:3.0${CRLF}`)).toBe(true);
    expect(long.endsWith(`END:VCARD${CRLF}`)).toBe(true);
    expect(long).not.toMatch(/[^\r]\n/);
    for (const line of linesOf(long)) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(long)).toContain(`PHOTO;VALUE=uri:https://images.example.com/${'a'.repeat(300)}.jpg`);
  });

  it('does not change the card it is given', () => {
    const input = card();
    const before = JSON.parse(JSON.stringify(input));
    buildMyCardVCard(input);
    expect(input).toEqual(before);
  });

  it('does not depend on the master sharing setting: that is the page\'s question', () => {
    expect(buildMyCardVCard(card({ sharingEnabled: false }))).toBe(buildMyCardVCard(card()));
  });
});

describe('My Card file name', () => {
  it('is the name with underscores and .vcf', () => {
    expect(myCardVCardFileName({ firstName: 'Ada', lastName: 'Lovelace' })).toBe('Ada_Lovelace.vcf');
    expect(myCardVCardFileName({ firstName: 'José', lastName: "O'Brien-Smith" })).toBe('José_O_Brien_Smith.vcf');
  });

  it('cannot hold a path or an extension of its own', () => {
    const name = myCardVCardFileName({ firstName: '../../etc/passwd', lastName: '.exe' });
    expect(name).not.toMatch(/[/\\]/);
    expect(name.endsWith('.vcf')).toBe(true);
    expect(name.match(/\./g)).toHaveLength(1);
  });

  it('falls back to "contact" without a name', () => {
    expect(myCardVCardFileName(null)).toBe('contact.vcf');
    expect(myCardVCardFileName({})).toBe('contact.vcf');
    expect(myCardVCardFileName({ firstName: '!!!' })).toBe('contact.vcf');
  });
});
