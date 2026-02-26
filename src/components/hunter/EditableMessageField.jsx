/**
 * EditableMessageField — Subject line + message body editor.
 *
 * Both fields are fully editable by the user.
 * onChange fires on every keystroke so parent can track current content.
 *
 * Props:
 *   subject   — current subject line string (controlled)
 *   message   — current message body string (controlled)
 *   onChange  — (field, value) callback where field is 'subject' | 'message'
 */

export default function EditableMessageField({ subject, message, onChange }) {
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
          className="emf-body"
          value={message || ''}
          onChange={e => onChange('message', e.target.value)}
          placeholder="Message body..."
          rows={6}
          aria-label="Message body"
        />
      </div>
    </div>
  );
}
