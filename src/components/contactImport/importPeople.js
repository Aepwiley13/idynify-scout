/** Contact Hub's words for the CSV importer, and the line My People shows afterwards. */

export const HUB_IMPORT_COPY = Object.freeze({
  title: 'Import people from a CSV file',
  incompleteSub: 'Imported with an email and no name. Add the name on their card later.',
  emailConflictTail: 'The email already on their card is kept.',
  incompleteNote: 'People with part of their name missing are still imported. Add the rest on their card later.',
  tagNote: 'as a record of this import.',
  failedTail: 'People saved before the error are already in My People.',
});

/** "5 people added", "4 people added, 1 already in My People", for the status line. Pure. */
export function importSummary(result) {
  const created = result?.created?.length ?? 0;
  const updated = result?.updated?.length ?? 0;
  const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const parts = [];
  if (created > 0) parts.push(`${people(created)} added`);
  if (updated > 0) parts.push(`${people(updated)} already in My People`);
  return parts.length ? `${parts.join(', ')}.` : '';
}
