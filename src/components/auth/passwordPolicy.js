/**
 * Turning a Firebase PasswordValidationStatus into rows the UI can render.
 *
 * Separate from the component so it can be tested directly against a policy
 * fixture — the question "does the checklist follow the policy" should be
 * answerable without mounting React.
 *
 * Only rules the policy actually ENFORCES produce a row. `customStrengthOptions`
 * carries the constraints that are switched on; the per-rule booleans on the
 * status are meaningless for constraints that are off, so reading them without
 * checking would invent requirements nobody is held to.
 */

export function rowsFromStatus(status) {
  const req = status?.passwordPolicy?.customStrengthOptions ?? {};
  const rows = [];

  const min = req.minPasswordLength;
  if (min) {
    rows.push({ key: 'length', label: `${min}+ characters`, met: !!status.meetsMinPasswordLength });
  }

  // Upper and lower are two policy switches but read as one human rule, so
  // they collapse into a single row when both are on — matching the approved
  // design, which says "Upper & lowercase letters" rather than listing two.
  //
  // NOTE THE FIELD NAMES. The REST endpoint returns `containsUppercaseCharacter`
  // and the SDK renames it to `containsUppercaseLetter` when it builds the
  // PasswordPolicy object (numeric and non-alphanumeric keep their names, so
  // only these two differ). Reading the REST spelling here silently dropped the
  // case rule from the checklist while the other rows kept working — visible
  // only by looking at the rendered list, which is what caught it. The REST
  // names are kept as a fallback in case a future SDK stops renaming.
  const upper = req.containsUppercaseLetter ?? req.containsUppercaseCharacter;
  const lower = req.containsLowercaseLetter ?? req.containsLowercaseCharacter;
  if (upper && lower) {
    rows.push({
      key: 'case',
      label: 'Upper & lowercase letters',
      met: !!status.containsUppercaseLetter && !!status.containsLowercaseLetter,
    });
  } else if (upper) {
    rows.push({ key: 'upper', label: 'An uppercase letter', met: !!status.containsUppercaseLetter });
  } else if (lower) {
    rows.push({ key: 'lower', label: 'A lowercase letter', met: !!status.containsLowercaseLetter });
  }

  if (req.containsNumericCharacter) {
    rows.push({ key: 'number', label: 'At least one number', met: !!status.containsNumericCharacter });
  }
  if (req.containsNonAlphanumericCharacter) {
    rows.push({ key: 'symbol', label: 'At least one symbol', met: !!status.containsNonAlphanumericCharacter });
  }

  return rows;
}
