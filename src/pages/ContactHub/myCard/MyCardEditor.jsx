/**
 * MyCardEditor — the form for a person's own card.
 *
 * A controlled component: it shows the draft it is given and reports what the
 * person does. It reads nothing, writes nothing and knows no route; the page
 * holds the draft (useCardDraft) and decides what Save means.
 *
 * Each field except the name has its own Shared / Private switch. The name is
 * always on the card. Where the account knows something that could fill an
 * empty field (the suggestions from utils/myCardSuggestions), the field offers
 * it as a button. Nothing is filled in until it is pressed.
 *
 * THE PHOTO has its own part (MyCardPhoto): Upload photo first, a LinkedIn photo
 * second when one is on offer, and the pasted link under "Advanced".
 */
import { useId } from 'react';
import { Sparkles } from 'lucide-react';
import MyCardPhoto from './MyCardPhoto';
import ShareToggle from './ShareToggle';
import { EDITOR_SECTIONS, FIELD_META } from './cardDraft';
import { SHAREABLE_FIELDS } from '../../../utils/myCardRules';
import { prepareProfilePhoto } from '../../../utils/photoPrep';
import { openSuggestions } from '../../../utils/myCardSuggestions';

const SOURCE_LABEL = Object.freeze({
  settings: 'your account', account: 'your account', linkedin: 'LinkedIn', recon: 'your Recon answers',
});

/** What the "use" button says: the value, and where it came from. */
function suggestionText(field, { value, source }) {
  const from = SOURCE_LABEL[source] ?? 'your account';
  if (field === 'photoUrl') return `Use my ${from} photo`;
  return `Use “${value}” from ${from}`;
}

/**
 * @param {object} props
 * @param {object} props.card        the draft's card (useCardDraft().card)
 * @param {Record<string,string>} [props.errors]   messages to show, by field (name under `name`)
 * @param {object} [props.suggestions]  buildCardSuggestions(...); offered for empty fields only
 * @param {(field: string, value: string) => void} props.onEdit
 * @param {(field: string) => void} props.onBlur
 * @param {(field: string, shared: boolean) => void} props.onShare
 * @param {(field: string, suggestion: object) => void} [props.onUseSuggestion]
 * @param {() => void} [props.onSubmit]  Enter in a field
 * @param {boolean} [props.disabled]
 * @param {typeof prepareProfilePhoto} [props.preparePhoto]  makes the photo from a picked file; replaceable for tests
 */
export default function MyCardEditor({
  card, errors = {}, suggestions = null, onEdit, onBlur, onShare, onUseSuggestion, onSubmit, disabled = false, preparePhoto = prepareProfilePhoto,
}) {
  const uid = useId();
  const open = openSuggestions(card, suggestions);
  const id = (field) => `${uid}-${field}`;

  // "Use “Ada Lovelace”": one button for whichever of the two names are empty and suggested.
  const nameFields = ['firstName', 'lastName'].filter((name) => open[name]);
  const nameSuggestion = nameFields.length
    ? { fields: nameFields, text: nameFields.map((name) => open[name].value).join(' '), source: open[nameFields[0]].source }
    : null;

  /** A "use this" chip: compact to look at, the full 44px to hit (see the stylesheet). */
  function suggestButton({ onClick, children, primary = false, icon = <Sparkles size={14} aria-hidden="true" /> }) {
    return (
      <button
        type="button"
        className={`mycard-suggest${primary ? ' mycard-suggest--primary' : ''}`}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
        <span>{children}</span>
      </button>
    );
  }


  function renderField(field) {
    const meta = FIELD_META[field];
    const isName = field === 'firstName' || field === 'lastName';
    const message = isName ? (field === 'firstName' ? errors.firstName ?? errors.name : errors.lastName) : errors[field];
    const hint = meta.hint;
    const messageId = `${id(field)}-message`;
    // The two name fields share one suggestion button, under both (see below).
    const suggestion = isName ? null : open[field];

    return (
      <div key={field} className={`mycard-field mycard-field--${field}`}>
        <div className="mycard-field-head">
          <label htmlFor={id(field)} className="mycard-label">{meta.label}</label>
          {SHAREABLE_FIELDS.includes(field) ? (
            <ShareToggle
              label={meta.label}
              shared={card.share[field] === true}
              onChange={(value) => onShare(field, value)}
              disabled={disabled}
            />
          ) : null}
        </div>
        <input
          id={id(field)}
          className="mycard-input"
          type={meta.type}
          inputMode={meta.inputMode}
          autoComplete={meta.autoComplete}
          placeholder={meta.placeholder}
          value={card[field]}
          disabled={disabled}
          aria-invalid={message ? 'true' : undefined}
          aria-describedby={message || hint ? messageId : undefined}
          spellCheck={false}
          autoCapitalize={isName || field === 'title' || field === 'organization' ? 'words' : 'none'}
          onChange={(event) => onEdit(field, event.target.value)}
          onBlur={() => onBlur(field)}
        />
        {suggestion && onUseSuggestion ? suggestButton({
          onClick: () => onUseSuggestion(field, suggestion),
          children: suggestionText(field, suggestion),
        }) : null}
        {message ? (
          <p id={messageId} className="mycard-message mycard-message--error" role="alert">{message}</p>
        ) : hint ? (
          <p id={messageId} className="mycard-message">{hint}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="mycard-editor"
      aria-label="Edit your card"
      noValidate
      onSubmit={(event) => { event.preventDefault(); }}
      // A form with several text fields and no submit button is not submitted by
      // Enter in a browser, so Enter in a field is handled here. Buttons (the
      // switches, the suggestions) keep their own Enter, and so does an input
      // method that is still composing a character.
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.target.tagName !== 'INPUT' || event.nativeEvent?.isComposing) return;
        event.preventDefault();
        onSubmit?.();
      }}
    >
      {EDITOR_SECTIONS.map((section) => (
        <section key={section.id} className="mycard-section" aria-labelledby={`${uid}-${section.id}`}>
          <h3 id={`${uid}-${section.id}`} className="mycard-section-title">{section.title}</h3>
          {section.id === 'you' ? (
            <>
              <MyCardPhoto
                card={card}
                message={errors.photoUrl}
                suggestion={open.photoUrl && onUseSuggestion ? { text: suggestionText('photoUrl', open.photoUrl), source: open.photoUrl.source } : null}
                onEdit={onEdit}
                onBlur={onBlur}
                onShare={onShare}
                onUseSuggestion={() => onUseSuggestion('photoUrl', open.photoUrl)}
                disabled={disabled}
                preparePhoto={preparePhoto}
              />
              <div className="mycard-name">
                {renderField('firstName')}
                {renderField('lastName')}
              </div>
              {nameSuggestion && onUseSuggestion ? suggestButton({
                onClick: () => nameSuggestion.fields.forEach((name) => onUseSuggestion(name, open[name])),
                children: `Use “${nameSuggestion.text}” from ${SOURCE_LABEL[nameSuggestion.source] ?? 'your account'}`,
              }) : null}
              <p className="mycard-always">Your name is always on your card.</p>
              {renderField('title')}
              {renderField('organization')}
            </>
          ) : section.fields.map(renderField)}
        </section>
      ))}
    </form>
  );
}
