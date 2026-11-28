/**
 * MyCardLinks — "Additional links" in the editor: up to five labelled web addresses (Facebook, a booking
 * page, an event), each with its own Shared / Private switch, like every other field.
 *
 * Each row is a Label, an Address and the switch; Remove closes the gap (the rows below move up, each
 * with its own switch, so a Private link can never take over a Shared one's). Add link disappears after
 * five. Messages are specific and appear once a row has been left or Save was tried ("Links must start
 * with https://"). A new link starts Private, like email and phone.
 *
 * A controlled component: it shows the draft's rows and reports what the person does.
 */
import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ShareToggle from './ShareToggle';
import { LINK_LIMITS, LINK_SLOTS } from '../../../utils/myCardRules';

/**
 * @param {object} props
 * @param {object} props.card  the draft's card
 * @param {Record<string,string>} [props.errors]  messages by slot (link1..link5)
 * @param {(slot: string, part: 'label'|'url', value: string) => void} props.onEditLink
 * @param {(slot: string) => void} props.onBlurLink
 * @param {(slot: string, shared: boolean) => void} props.onShare
 * @param {() => void} props.onAddLink
 * @param {(slot: string) => void} props.onRemoveLink
 * @param {boolean} [props.disabled]
 */
export default function MyCardLinks({
  card, errors = {}, onEditLink, onBlurLink, onShare, onAddLink, onRemoveLink, disabled = false,
}) {
  const uid = useId();
  const rows = LINK_SLOTS.filter((slot) => card[slot]);
  return (
    <section className="mycard-section" aria-labelledby={`${uid}-links`}>
      <h3 id={`${uid}-links`} className="mycard-section-title">Additional links</h3>
      <p className="mycard-always">Add up to {LINK_LIMITS.count}: a booking page, Facebook, an event. Each has its own Shared / Private switch.</p>
      {rows.map((slot, index) => {
        const message = errors[slot];
        const messageId = `${uid}-${slot}-message`;
        const row = card[slot];
        return (
          <div key={slot} className="mycard-field mycard-link-row" role="group" aria-label={`Link ${index + 1}`}>
            <div className="mycard-field-head">
              <label htmlFor={`${uid}-${slot}-label`} className="mycard-label">Link {index + 1} name</label>
              <ShareToggle label={`Link ${index + 1}`} shared={card.share[slot] === true} onChange={(value) => onShare(slot, value)} disabled={disabled} />
            </div>
            <input
              id={`${uid}-${slot}-label`}
              className="mycard-input"
              type="text"
              inputMode="text"
              autoComplete="off"
              placeholder="Book a meeting"
              value={row.label}
              disabled={disabled}
              maxLength={LINK_LIMITS.label * 2}
              aria-invalid={message ? 'true' : undefined}
              aria-describedby={message ? messageId : undefined}
              onChange={(event) => onEditLink(slot, 'label', event.target.value)}
              onBlur={() => onBlurLink(slot)}
            />
            <label htmlFor={`${uid}-${slot}-url`} className="mycard-label">Link {index + 1} address</label>
            <input
              id={`${uid}-${slot}-url`}
              className="mycard-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="https://calendly.com/your-name"
              value={row.url}
              disabled={disabled}
              aria-invalid={message ? 'true' : undefined}
              aria-describedby={message ? messageId : undefined}
              onChange={(event) => onEditLink(slot, 'url', event.target.value)}
              onBlur={() => onBlurLink(slot)}
            />
            {message ? <p id={messageId} className="mycard-message mycard-message--error" role="alert">{message}</p> : null}
            <button type="button" className="mycard-linkbtn" disabled={disabled} onClick={() => onRemoveLink(slot)}>
              <Trash2 size={14} aria-hidden="true" /> Remove link {index + 1}
            </button>
          </div>
        );
      })}
      {rows.length < LINK_LIMITS.count ? (
        <button type="button" className="mycard-btn mycard-btn--secondary mycard-add-link" disabled={disabled} onClick={onAddLink}>
          <Plus size={18} aria-hidden="true" /><span>Add link</span>
        </button>
      ) : null}
    </section>
  );
}
