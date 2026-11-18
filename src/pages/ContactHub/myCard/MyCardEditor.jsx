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
 * THE PHOTO is the friendliest part. With a LinkedIn photo on offer, that is
 * the one big button; the pasted link is still there ("Paste a photo link
 * instead") for anyone who wants another picture. With a photo, the raw link is
 * tucked away behind "Change photo link" (the photo can also be removed).
 * With nothing on offer, the link field is simply there.
 *
 * The link is never hidden when it needs attention: a message about it, a
 * value the rules refuse and a picture that did not load all show it. Once it
 * has been shown it stays, so it cannot vanish while it is being typed in.
 */
import { useId, useRef, useState } from 'react';
import { Linkedin, Sparkles } from 'lucide-react';
import CardAvatar from './CardAvatar';
import ShareToggle from './ShareToggle';
import { EDITOR_SECTIONS, FIELD_META } from './cardDraft';
import { SHAREABLE_FIELDS, cardInitials, isPhotoPicture, normalizeCardField } from '../../../utils/myCardRules';
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
 */
export default function MyCardEditor({
  card, errors = {}, suggestions = null, onEdit, onBlur, onShare, onUseSuggestion, onSubmit, disabled = false,
}) {
  const uid = useId();
  const open = openSuggestions(card, suggestions);
  const [failedPhoto, setFailedPhoto] = useState(null);
  const [revealPhotoLink, setRevealPhotoLink] = useState(false);
  // Set when the link is revealed by a button, so the field takes focus as it appears
  // (the button that was pressed is gone, and focus would otherwise be lost).
  const focusLinkWhenShown = useRef(false);
  const id = (field) => `${uid}-${field}`;
  const showPhotoLink = () => { focusLinkWhenShown.current = true; setRevealPhotoLink(true); };

  const validPhoto = normalizeCardField('photoUrl', card.photoUrl).value;
  const photoProblem = failedPhoto !== null && failedPhoto === validPhoto;

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

  function renderPhoto() {
    const meta = FIELD_META.photoUrl;
    const message = errors.photoUrl;
    const suggestion = open.photoUrl && onUseSuggestion ? open.photoUrl : null;
    const hasPhoto = card.photoUrl.trim() !== '';
    // With a good photo the raw link stays out of the way. It is shown when it was asked
    // for (and stays), when it has a message, when what is there is not a valid link or
    // did not load a picture, and when there is no photo on offer (it is then the only way in).
    const hasGoodPhoto = hasPhoto && validPhoto !== '';
    const showLink = revealPhotoLink || Boolean(message) || photoProblem || (hasPhoto && !hasGoodPhoto) || (!suggestion && !hasPhoto);
    // A picture kept in the card is a very long string of letters and digits: never shown as text, or put in a box.
    const photoIsData = isPhotoPicture(card.photoUrl);
    const hint = photoProblem
      ? 'That link didn\'t load a picture, so your initials are used. Check the link, or leave it empty.'
      : (photoIsData && hasGoodPhoto ? 'Your uploaded photo is in use. Paste a link to use that instead, or remove the photo.' : meta.hint);
    const messageId = `${id('photoUrl')}-message`;

    return (
      <div key="photoUrl" className="mycard-field mycard-field--photoUrl">
        <div className="mycard-photo-row">
          <CardAvatar photoUrl={validPhoto} initials={cardInitials(card)} size="lg" onPhotoFailed={setFailedPhoto} />
          <div className="mycard-photo-main">
            <div className="mycard-field-head">
              <span className="mycard-label">Photo</span>
              <ShareToggle
                label={meta.shareLabel}
                shared={card.share.photoUrl === true}
                onChange={(value) => onShare('photoUrl', value)}
                disabled={disabled}
              />
            </div>
            {suggestion ? suggestButton({
              primary: true,
              icon: suggestion.source === 'linkedin' ? <Linkedin size={16} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />,
              onClick: () => onUseSuggestion('photoUrl', suggestion),
              children: suggestionText('photoUrl', suggestion),
            }) : null}
            {(suggestion && !showLink) || (hasGoodPhoto && !showLink) || hasPhoto ? (
              <div className="mycard-photo-actions">
                {suggestion && !showLink ? (
                  <button type="button" className="mycard-linkbtn" disabled={disabled} onClick={showPhotoLink}>
                    Paste a photo link instead
                  </button>
                ) : null}
                {hasGoodPhoto && !showLink ? (
                  <button type="button" className="mycard-linkbtn" disabled={disabled} onClick={showPhotoLink}>
                    {photoIsData ? 'Use a photo link instead' : 'Change photo link'}
                  </button>
                ) : null}
                {hasPhoto ? (
                  <button
                    type="button"
                    className="mycard-linkbtn"
                    disabled={disabled}
                    onClick={() => { setRevealPhotoLink(false); onEdit('photoUrl', ''); }}
                  >
                    Remove photo
                  </button>
                ) : null}
              </div>
            ) : null}
            {!suggestion && !hasPhoto ? <p className="mycard-message">Add a photo so people recognize you.</p> : null}
          </div>
        </div>
        {showLink ? (
          <div className="mycard-field">
            <label htmlFor={id('photoUrl')} className="mycard-label">{meta.label}</label>
            <input
              id={id('photoUrl')}
              ref={(element) => {
                if (element && focusLinkWhenShown.current) { focusLinkWhenShown.current = false; element.focus(); }
              }}
              className="mycard-input"
              type={meta.type}
              inputMode={meta.inputMode}
              autoComplete={meta.autoComplete}
              placeholder={meta.placeholder}
              value={photoIsData ? '' : card.photoUrl}
              disabled={disabled}
              aria-invalid={message ? 'true' : undefined}
              aria-describedby={message || hint ? messageId : undefined}
              spellCheck={false}
              autoCapitalize="none"
              // Once the link is being edited it stays, however the value looks mid-typing.
              onChange={(event) => { setRevealPhotoLink(true); onEdit('photoUrl', event.target.value); }}
              onBlur={() => onBlur('photoUrl')}
            />
            {message ? (
              <p id={messageId} className="mycard-message mycard-message--error" role="alert">{message}</p>
            ) : hint ? (
              <p id={messageId} className="mycard-message">{hint}</p>
            ) : null}
          </div>
        ) : null}
      </div>
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
              {renderPhoto()}
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
