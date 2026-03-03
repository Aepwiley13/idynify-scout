import { useRef, useEffect } from 'react';

/**
 * EditableMessageField — Subject line + message body editor.
 *
 * Both fields are fully editable by the user.
 * onChange fires on every keystroke so parent can track current content.
 * The message textarea auto-expands to fit its content.
 *
 * Props:
 *   subject   — current subject line string (controlled)
 *   message   — current message body string (controlled)
 *   onChange  — (field, value) callback where field is 'subject' | 'message'
 */

export default function EditableMessageField({ subject, message, onChange }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [message]);

  return (
    <div className="emf-field">
      <div className="emf-subject-row">
        <label className="emf-label">Subject</label>
        <input
          className="emf-subject"
          type="text"
          value={subject || ''}
          onChange={e => onChange('subject', e.target.value)}
          placeholder="Subject line..."
          aria-label="Email subject"
        />
      </div>

      <div className="emf-body-row">
        <label className="emf-label">Message</label>
        <textarea
          ref={textareaRef}
          className="emf-body"
          value={message || ''}
          onChange={e => onChange('message', e.target.value)}
          placeholder="Message body..."
          aria-label="Message body"
          style={{ resize: 'none', overflow: 'hidden', minHeight: '120px' }}
        />
      </div>
    </div>
  );
}
