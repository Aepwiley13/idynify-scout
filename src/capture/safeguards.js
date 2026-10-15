/**
 * Capture safeguards — evidence that must never become a company.
 *
 * Part of the Relationship Capture foundation (PR 2). Pure and runtime-
 * independent, and NOT IMPORTED BY THE APP YET (see
 * src/test/captureNoProductionImports.test.js).
 *
 * WHY A SEPARATE, LARGER LIST
 * ──────────────────────────
 * companyIdentityService.FREE_EMAIL_DOMAINS drives today's company matching
 * and is deliberately left untouched: extending it would change which
 * companies existing users get linked to. The lists here are a superset
 * (a test enforces that) used only by capture. Consolidation is decided when
 * the new company resolver adopts these modules.
 *
 * WHAT A SAFEGUARD DOES
 * ────────────────────
 * Each block yields a machine-readable code (SAFEGUARDS) for review wording,
 * analytics and debugging. Most codes only govern whether evidence may
 * identify or create a company; they do not mean the card was misread. The
 * few that do (a title read as a company, say) also cap the field's
 * extraction level in confidence.js. Saving a person without a company is
 * always acceptable, so a safeguard can lower what happens to the company but
 * never blocks the person.
 *
 * Resolver-time safeguards that need workspace data (two companies with the
 * same name; a domain that already exists) belong to the company resolver,
 * not here.
 */

import { nameKey } from '../utils/identityNormalization.js';
import {
  domainKey, domainStem, emailHost, hostOf, ocrSuspectedHost, personNameKey, validateEmail,
} from './validators.js';

export const SAFEGUARDS = Object.freeze({
  FREE_EMAIL_DOMAIN: 'FREE_EMAIL_DOMAIN',
  ISP_EMAIL_DOMAIN: 'ISP_EMAIL_DOMAIN',
  SHARED_HOST_DOMAIN: 'SHARED_HOST_DOMAIN',
  ROLE_EMAIL: 'ROLE_EMAIL',
  INVALID_DOMAIN: 'INVALID_DOMAIN',
  OCR_SUSPECTED: 'OCR_SUSPECTED',
  WEBSITE_FROM_EMAIL: 'WEBSITE_FROM_EMAIL',
  INFERRED_COMPANY_NAME: 'INFERRED_COMPANY_NAME',
  MISSING_DOMAIN: 'MISSING_DOMAIN',
  GENERIC_COMPANY_NAME: 'GENERIC_COMPANY_NAME',
  TITLE_AS_COMPANY: 'TITLE_AS_COMPANY',
  PERSON_NAME_AS_COMPANY: 'PERSON_NAME_AS_COMPANY',
  COMPANY_NAME_TOO_SHORT: 'COMPANY_NAME_TOO_SHORT',
  WEAK_COMPANY_TEXT: 'WEAK_COMPANY_TEXT',
});

// ─── Lists ───────────────────────────────────────────────────────────────────

/** Personal mailbox providers, as registrable domains. */
export const CAPTURE_FREE_EMAIL_DOMAINS = Object.freeze(new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.com.au',
  'yahoo.co.in', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.it', 'yahoo.co.jp',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.it', 'hotmail.es',
  'outlook.com', 'outlook.fr', 'outlook.de', 'outlook.es',
  'live.com', 'live.co.uk', 'live.ca', 'live.fr', 'live.de', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aol.co.uk', 'aim.com',
  'protonmail.com', 'protonmail.ch', 'proton.me', 'pm.me',
  'gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch', 'gmx.co.uk',
  'mail.com', 'email.com', 'zoho.com', 'zohomail.com',
  'yandex.com', 'yandex.ru', 'ya.ru', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru',
  'fastmail.com', 'fastmail.fm', 'hey.com', 'tutanota.com', 'tuta.io',
  'qq.com', '163.com', '126.com', 'yeah.net', 'sina.com',
  'naver.com', 'daum.net', 'hanmail.net',
  'web.de', 'freenet.de', 'libero.it', 'laposte.net', 'seznam.cz', 'wp.pl', 'o2.pl',
  'interia.pl', 'rediffmail.com',
]));

/** Internet-provider mailboxes: personal too, but named for the record. */
export const CAPTURE_ISP_EMAIL_DOMAINS = Object.freeze(new Set([
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net', 'charter.net',
  'spectrum.net', 'earthlink.net', 'optonline.net', 'optimum.net', 'frontier.com',
  'frontiernet.net', 'centurylink.net', 'windstream.net', 'bellsouth.net', 'roadrunner.com',
  'rr.com', 'juno.com', 'netzero.net',
  'btinternet.com', 'btopenworld.com', 'sky.com', 'virginmedia.com', 'talktalk.net', 'ntlworld.com',
  'shaw.ca', 'rogers.com', 'sympatico.ca', 'telus.net', 'videotron.ca',
  'bigpond.com', 'bigpond.net.au', 'optusnet.com.au',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 't-online.de', 'telenet.be', 'ziggo.nl', 'xs4all.nl',
]));

/**
 * Hosts that serve many unrelated owners: site builders, link-in-bio pages and
 * social networks. Matched by HOSTNAME, because several of them
 * (`sites.google.com`, `acme.wixsite.com`) key to a registrable domain that
 * belongs to someone else entirely. Kept as a website, never a company key.
 */
export const SHARED_HOST_SUFFIXES = Object.freeze([
  'wixsite.com', 'squarespace.com', 'business.site', 'github.io', 'gitlab.io', 'linktr.ee',
  'sites.google.com', 'carrd.co', 'webflow.io', 'wordpress.com', 'blogspot.com', 'weebly.com',
  'godaddysites.com', 'square.site', 'myshopify.com', 'netlify.app', 'vercel.app', 'pages.dev',
  'herokuapp.com', 'notion.site', 'bio.link', 'beacons.ai', 'about.me',
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'medium.com', 'substack.com',
]);

/** Mailbox names that belong to a function, not a person. */
export const ROLE_LOCAL_PARTS = Object.freeze(new Set([
  'info', 'sales', 'contact', 'contactus', 'hello', 'hi', 'admin', 'administrator', 'support',
  'help', 'office', 'team', 'enquiries', 'enquiry', 'inquiries', 'inquiry', 'billing',
  'accounts', 'accounting', 'finance', 'hr', 'careers', 'jobs', 'recruiting', 'marketing',
  'press', 'media', 'pr', 'news', 'noreply', 'no-reply', 'donotreply', 'reception', 'service',
  'services', 'customerservice', 'orders', 'bookings', 'reservations', 'events', 'partners',
  'webmaster', 'postmaster', 'mail', 'general',
]));

/** A company name made only of these (after nameKey) says nothing about which company. */
export const GENERIC_COMPANY_WORDS = Object.freeze(new Set([
  'consulting', 'group', 'solutions', 'services', 'partners', 'holdings', 'global',
  'international', 'agency', 'studio', 'company', 'enterprises', 'ventures', 'capital',
  'and', 'of',
]));

/** Words that make up job titles. */
export const TITLE_WORDS = Object.freeze(new Set([
  'chief', 'executive', 'officer', 'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'cro', 'cpo', 'ciso',
  'president', 'vice', 'vp', 'svp', 'evp', 'avp', 'director', 'manager', 'head', 'lead',
  'founder', 'cofounder', 'co', 'owner', 'principal', 'partner', 'senior', 'sr', 'junior', 'jr',
  'associate', 'assistant', 'analyst', 'engineer', 'developer', 'designer', 'consultant',
  'specialist', 'coordinator', 'administrator', 'representative', 'rep', 'account',
  'sales', 'marketing', 'operations', 'product', 'engineering', 'finance', 'technology',
  'business', 'development', 'general', 'managing', 'board', 'member', 'chair', 'chairman',
  'chairwoman', 'chairperson', 'secretary', 'treasurer', 'intern', 'of', 'and', 'the',
]));

/** At least one of these must be present for text to read as a title, not a department. */
const ROLE_WORDS = new Set([
  'ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'cro', 'cpo', 'ciso', 'officer', 'president', 'vp',
  'svp', 'evp', 'avp', 'director', 'manager', 'head', 'founder', 'cofounder', 'owner',
  'principal', 'partner', 'chair', 'chairman', 'chairwoman', 'chairperson', 'secretary',
  'treasurer', 'intern', 'consultant', 'engineer', 'analyst', 'specialist', 'coordinator',
]);

// ─── Predicates ──────────────────────────────────────────────────────────────

export function isSharedHost(input) {
  const host = hostOf(input);
  if (!host) return false;
  return SHARED_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

/** 'personal' (free-mail or ISP), 'role', 'work', or 'unknown' (not a valid address). */
export function classifyEmailKind(email) {
  const { ok, normalized } = validateEmail(email);
  if (!ok) return 'unknown';
  const key = domainKey(emailHost(normalized));
  if (CAPTURE_FREE_EMAIL_DOMAINS.has(key) || CAPTURE_ISP_EMAIL_DOMAINS.has(key)) return 'personal';
  if (ROLE_LOCAL_PARTS.has(normalized.slice(0, normalized.lastIndexOf('@')).split('+')[0])) return 'role';
  return 'work';
}

/** Codes that stop a host or domain from being a company key. Empty means usable. */
export function domainSafeguards(input) {
  const host = hostOf(input);
  const key = domainKey(host);
  if (!key) {
    return host && ocrSuspectedHost(host)
      ? [SAFEGUARDS.INVALID_DOMAIN, SAFEGUARDS.OCR_SUSPECTED]
      : [SAFEGUARDS.INVALID_DOMAIN];
  }
  if (CAPTURE_FREE_EMAIL_DOMAINS.has(key)) return [SAFEGUARDS.FREE_EMAIL_DOMAIN];
  if (CAPTURE_ISP_EMAIL_DOMAINS.has(key)) return [SAFEGUARDS.ISP_EMAIL_DOMAIN];
  if (isSharedHost(host)) return [SAFEGUARDS.SHARED_HOST_DOMAIN];
  return [];
}

/**
 * Codes that stop an email's domain from being company evidence. A role
 * address (info@, sales@) is still saved as the person's email; its domain is
 * just not used to infer the company, per the capture contract.
 */
export function emailDomainSafeguards(email) {
  const host = emailHost(email);
  if (!host) return [SAFEGUARDS.INVALID_DOMAIN];
  const codes = domainSafeguards(host);
  if (classifyEmailKind(email) === 'role') codes.push(SAFEGUARDS.ROLE_EMAIL);
  return codes;
}

/**
 * Codes for a printed website. WEBSITE_FROM_EMAIL catches the legacy failure
 * where an email's local part (`jane.smith` from jane.smith@acme.com) was
 * taken for a website.
 */
export function websiteSafeguards(website, { emails = [] } = {}) {
  if (typeof website !== 'string' || !website.trim()) return [];
  const text = website.trim().toLowerCase();
  const locals = emails
    .map(email => (typeof email === 'string' ? email.trim().toLowerCase() : ''))
    .filter(email => email.includes('@'))
    .map(email => email.slice(0, email.lastIndexOf('@')));
  const bare = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  // An @ before the path makes it an email address; one in the path
  // (`youtube.com/@acme`) is an ordinary URL.
  const authority = bare.split(/[/?#]/)[0];
  if (authority.includes('@') || locals.includes(bare)) return [SAFEGUARDS.WEBSITE_FROM_EMAIL];
  return domainSafeguards(text);
}

function isTitleText(key) {
  const tokens = key.split(' ');
  return tokens.every(token => TITLE_WORDS.has(token)) && tokens.some(token => ROLE_WORDS.has(token));
}

/**
 * Codes for a company name. `field` is the CardExtraction company.name field
 * (its value, source and level matter); the context lets a name be compared
 * with the person's name, title and printed domain.
 */
export function companyNameSafeguards(field, { personName = null, title = null, domain = null } = {}) {
  const value = field?.value;
  if (typeof value !== 'string' || !value.trim()) return [];
  const codes = [];
  const key = nameKey(value);
  const stem = domainStem(domain);

  if (field.source === 'inferred') codes.push(SAFEGUARDS.INFERRED_COMPANY_NAME);
  if (field.source === 'card_logo' || ['possible', 'unknown'].includes(field.extraction?.level)) {
    codes.push(SAFEGUARDS.WEAK_COMPANY_TEXT);
  }
  if (!key || key.split(' ').every(token => GENERIC_COMPANY_WORDS.has(token))) {
    codes.push(SAFEGUARDS.GENERIC_COMPANY_NAME);
  }
  if (key && (isTitleText(key) || (title && personNameKey(title) === personNameKey(value)))) {
    codes.push(SAFEGUARDS.TITLE_AS_COMPANY);
  }
  if (key && personName && key === nameKey(personName)) codes.push(SAFEGUARDS.PERSON_NAME_AS_COMPANY);
  if (key && key.replace(/ /g, '').length < 2 && key.replace(/ /g, '') !== stem) {
    codes.push(SAFEGUARDS.COMPANY_NAME_TOO_SHORT);
  }
  return codes;
}

/** Codes that make a company name unusable as evidence on its own. */
const NAME_BLOCKING = new Set([
  SAFEGUARDS.GENERIC_COMPANY_NAME, SAFEGUARDS.TITLE_AS_COMPANY, SAFEGUARDS.PERSON_NAME_AS_COMPANY,
  SAFEGUARDS.COMPANY_NAME_TOO_SHORT, SAFEGUARDS.WEAK_COMPANY_TEXT, SAFEGUARDS.INFERRED_COMPANY_NAME,
]);

function nameAgreesWithStem(key, stem) {
  if (!key || !stem) return false;
  const compact = key.replace(/ /g, '');
  return compact === stem || compact.startsWith(stem) || stem.startsWith(compact) || key.split(' ').includes(stem);
}

/**
 * The most that card evidence alone allows for the company, before any
 * workspace lookup. The resolver can only do less, never more.
 *
 *   NEW_CONFIRMED              a printed name and a printed-website domain agree
 *                              and nothing fired
 *   NEW_REQUIRES_CONFIRMATION  some usable evidence, but not enough to act alone
 *   SUGGESTION_ONLY            only weak text (pre-fills "+ Add company")
 *   UNKNOWN                    nothing usable ("No company on this card")
 *
 * Never manufactures a display name: a domain from `sarah@acme.com` gives a
 * domain candidate and `name.display: null`, not "Acme".
 *
 * @param {object} input
 * @param {object|null} input.companyName  the company.name field
 * @param {string|null} input.website       printed website text
 * @param {string[]}    input.emails        printed emails
 * @param {string|null} input.personName
 * @param {string|null} input.title
 */
export function assessCompanyEvidence({ companyName = null, website = null, emails = [], personName = null, title = null } = {}) {
  const codes = [];
  let domain = { key: null, from: null, usable: false };

  if (typeof website === 'string' && website.trim()) {
    const websiteCodes = websiteSafeguards(website, { emails });
    codes.push(...websiteCodes);
    if (!websiteCodes.length) domain = { key: domainKey(website), from: 'website', usable: true };
  }

  if (!domain.usable) {
    for (const email of emails) {
      const emailCodes = emailDomainSafeguards(email);
      codes.push(...emailCodes);
      if (!emailCodes.length && !domain.usable) {
        domain = { key: domainKey(emailHost(email)), from: 'email_domain', usable: true };
      }
    }
  }

  const nameCodes = companyNameSafeguards(companyName, { personName, title, domain: domain.key });
  codes.push(...nameCodes);
  const display = typeof companyName?.value === 'string' && companyName.value.trim() ? companyName.value.trim() : null;
  const name = {
    key: display ? nameKey(display) : null,
    display,
    usable: Boolean(display && nameKey(display) && !nameCodes.some(code => NAME_BLOCKING.has(code))),
  };

  if (name.usable && !domain.usable) codes.push(SAFEGUARDS.MISSING_DOMAIN);

  let creationCeiling;
  if (domain.usable && domain.from === 'website' && name.usable && nameAgreesWithStem(name.key, domainStem(domain.key))) {
    creationCeiling = 'NEW_CONFIRMED';
  } else if (domain.usable || name.usable) {
    creationCeiling = 'NEW_REQUIRES_CONFIRMATION';
  } else if (display) {
    creationCeiling = 'SUGGESTION_ONLY';
  } else {
    creationCeiling = 'UNKNOWN';
  }

  return { codes: [...new Set(codes)], domain, name, creationCeiling };
}
