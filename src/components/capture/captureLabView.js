/**
 * The Capture Lab's pure view helpers: the field rows it shows, and the
 * diagnostics it copies. The diagnostics hold sizes, timings, codes,
 * versions and counts, never a card value.
 */

/** Every field of a CardExtraction as display rows, empty ones included so gaps are visible. */
export function extractionRows(extraction) {
  const rows = [];
  const add = (label, field, note = '') => rows.push({ label, field, note });
  const { person, company } = extraction;
  add('Full name', person.fullName);
  add('Given name', person.givenName);
  add('Middle name', person.middleName);
  add('Family name', person.familyName);
  add('Suffix', person.suffix);
  add('Title', person.title);
  if (person.emails.length) person.emails.forEach((f, i) => add(`Email ${i + 1}`, f, f.kind));
  else add('Email', { value: null, extraction: { level: 'unknown', score: 0, checks: [] } });
  if (person.phones.length) {
    person.phones.forEach((f, i) => add(`Phone ${i + 1}`, f, [f.kind.value ? `${f.kind.value} (${f.kind.extraction.level})` : 'no label', f.extension ? `ext ${f.extension}` : ''].filter(Boolean).join(' · ')));
  } else add('Phone', { value: null, extraction: { level: 'unknown', score: 0, checks: [] } });
  add('LinkedIn', person.linkedinUrl);
  person.socials.forEach((f, i) => add(`Social ${i + 1}`, f, f.platform.value ? `${f.platform.value} (${f.platform.extraction.level})` : 'network not shown'));
  add('Company', company.name, company.name.source === 'card_logo' ? 'from logo' : '');
  add('Domain', company.domain, company.domain.inferredFrom ? `from ${company.domain.inferredFrom}` : '');
  add('Website', company.website);
  add('Address', company.address);
  add('Company LinkedIn', company.linkedinUrl);
  return rows;
}

/**
 * Diagnostics without a single card value: sizes, timings, codes, versions and
 * counts, to paste into a test note.
 */
export function diagnostics({ original, prepared, result, device }) {
  const extraction = result?.body?.extraction;
  return {
    device: device ?? null,
    original: original ? { type: original.type || null, bytes: original.size } : null,
    prepared: prepared ? {
      widthPx: prepared.image.widthPx, heightPx: prepared.image.heightPx, bytes: prepared.image.bytes, prepMs: prepared.prepMs,
      ...prepared.image.preflight,
    } : null,
    extraction: result ? {
      httpStatus: result.status,
      roundTripMs: result.ms,
      error: result.body?.error ?? null,
      reason: result.body?.reason ?? null,
      status: extraction?.capture.status ?? null,
      provider: extraction?.capture.provider ?? null,
      timing: extraction?.capture.timing ?? null,
      usage: extraction?.capture.usage ?? null,
      counts: extraction?.capture.counts ?? null,
      safeguards: extraction?.company.safeguards ?? null,
    } : null,
  };
}
