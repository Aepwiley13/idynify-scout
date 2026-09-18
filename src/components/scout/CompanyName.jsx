/**
 * CompanyName.jsx — a company's name, marked when the name is a guess.
 *
 * WHY THIS IS A COMPONENT AND NOT `{company.name}`
 * ───────────────────────────────────────────────
 * `ensureCompanyForContact` can create a company whose name it guessed from a
 * work-email domain, and marks it `name_source: 'email_domain'`. Enrichment
 * corrects that name — but only when someone opens the company's detail page.
 * Until then the guess is rendered in Saved Companies, in the swipe deck and in
 * the card grid looking exactly as confirmed as a name Apollo returned.
 *
 * Every one of those surfaces rendered `{company.name}` inline. Marking the
 * guess in one of them and not the others would be its own kind of wrong, so
 * the treatment lives here and the surfaces call it.
 *
 * Presentation only: it reads `name_source`, never writes it, and never
 * triggers enrichment. Correcting the name is enrichment's job.
 */
import { getDisplayName } from '../../utils/companyDisplay';
import { useT } from '../../theme/ThemeContext';

export default function CompanyName({ company, style = {}, hintStyle = {}, fallback = 'Unknown' }) {
  const T = useT();
  const { label, hint } = getDisplayName(company, fallback);

  return (
    <span style={style}>
      {label}
      {hint && (
        <span
          style={{ fontWeight: 400, color: T.textFaint, marginLeft: 5, ...hintStyle }}
          // Screen readers and hover both get the reason, so the muted text
          // does not read as an unexplained second name.
          title={`Name not confirmed — "${hint}" was derived from the domain`}
        >
          ({hint})
        </span>
      )}
    </span>
  );
}
