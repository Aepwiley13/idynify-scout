/**
 * HubTable — My People as a compact table (desktop only, optional).
 *
 * The same people, in the same order, under the same search and sticker
 * filter as the list: it is given the rows to draw and decides nothing about
 * who is in them. Columns are Name, Email, Phone, Stickers, Added. There is no
 * status, stage or source column: nothing from the sales product belongs here.
 *
 * Built from divs with table roles rather than a <table>, for two reasons the
 * list already solved: the whole row opens the person (the name link's hit
 * area is stretched over it, which needs a positioned row), and the sticker
 * picker must open over the rows below without being clipped.
 *
 * Email and phone are real links, so they work from the keyboard and on
 * touch, and a long address wraps instead of being cut off. Nothing here is
 * available only on hover.
 *
 * The Stickers column exists only when stickers are available for the user.
 * `tight` (a narrow content area) leaves out Added so the other columns keep
 * their room; the date is still on the list view and the person's page.
 */
import { Link } from 'react-router-dom';
import { Mail, Phone } from 'lucide-react';
import { useT } from '../../theme/ThemeContext';
import { contactHubPersonPath } from '../../constants/contactHub';
import ContactCardStickersInteractive from '../../components/stickers/ContactCardStickersInteractive';
import { personName, emailOf, phoneOf, companyOf } from './peopleRules';

export default function HubTable({ rows, showStickers, tight = false, stickerMax, onStickerChange, renderAvatar, selection }) {
  const T = useT();
  const none = <span aria-hidden="true" style={{ color: T.textMuted }}>—</span>;

  return (
    <div
      className={`hub-table${showStickers ? '' : ' hub-table--no-stickers'}${tight ? ' hub-table--tight' : ''}`}
      role="table"
      aria-label="My People"
      aria-rowcount={rows.length + 1}
    >
      <div role="rowgroup">
        <div className="hub-tr hub-tr--head" role="row" style={{ color: T.textMuted, borderColor: T.border }}>
          {selection && <span role="columnheader" aria-label="Select contact" />}
          <span role="columnheader">Name</span>
          <span role="columnheader">Company</span>
          <span role="columnheader">Email</span>
          <span role="columnheader">Phone</span>
          {showStickers ? <span role="columnheader">Stickers</span> : null}
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((contact) => {
          const name = personName(contact);
          const email = emailOf(contact);
          const phone = phoneOf(contact);
          const company = companyOf(contact);
          return (
            <div key={contact.id} className="hub-tr" role="row" style={{ borderColor: T.border }}>
              {selection && <span className="hub-td hub-td--select" role="cell">{selection(contact)}</span>}
              <span className="hub-td hub-td--name" role="cell">
                {renderAvatar(contact, name)}
                <Link className="hub-row-link" to={contactHubPersonPath(contact.id)} style={{ color: T.text }}>
                  {name}
                </Link>
              </span>
              <span className="hub-td hub-td--company" role="cell">{company || <>{none}<span className="hub-sr">No company</span></>}</span>
              <span className="hub-td hub-td--wrap" role="cell">
                {email
                  ? <a className="hub-td-link hub-td-link--email" href={`mailto:${email}`} aria-label={`Email ${name}, ${email}`} style={{ color: T.text }}><Mail size={16} aria-hidden="true" /><span>{email}</span></a>
                  : <>{none}<span className="hub-sr">No email</span></>}
              </span>
              <span className="hub-td hub-td--phone" role="cell">
                {phone
                  ? <a className="hub-td-link hub-td-link--phone" href={`tel:${phone}`} aria-label={`Call ${name}, ${phone}`} style={{ color: T.text }}><Phone size={16} aria-hidden="true" /><span>{phone}</span></a>
                  : <>{none}<span className="hub-sr">No phone</span></>}
              </span>
              {showStickers ? (
                <span className="hub-td hub-row-stickers" role="cell">
                  <ContactCardStickersInteractive contact={contact} max={stickerMax} onUpdate={onStickerChange} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
