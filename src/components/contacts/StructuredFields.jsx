import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Settings2 } from 'lucide-react';
import {
  RELATIONSHIP_TYPES,
  RELATIONSHIP_STATES,
  WARMTH_LEVELS,
  STRATEGIC_VALUES,
  getLabelById
} from '../../constants/structuredFields';
import './StructuredFields.css';

/**
 * STRUCTURED FIELDS
 *
 * Inline classification panel for Contact strategic context.
 * Feeds Barry's prompt with structured inputs for consistent intelligence.
 *
 * Fields:
 *   relationship_type  → Prospect / Known / Partner / Delegate
 *   warmth_level       → Cold / Warm / Hot
 *   strategic_value    → Low / Medium / High
 *
 * These are SEPARATE from engagementIntent (Hunter messaging flow).
 */

export default function StructuredFields({ contact, onUpdate }) {
  const [saving, setSaving] = useState(false);

  async function handleFieldChange(fieldName, value) {
    const user = auth.currentUser;
    if (!user || !contact?.id) return;

    // Optimistic update
    const updatedContact = { ...contact, [fieldName]: value };
    onUpdate(updatedContact);

    try {
      setSaving(true);
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        [fieldName]: value,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error(`[StructuredFields] Error saving ${fieldName}:`, error);
      // Revert on failure
      onUpdate(contact);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="structured-fields">
      <div className="structured-fields-header">
        <Settings2 className="w-4 h-4" />
        <span>Strategic Context</span>
        {saving && <span className="sf-saving-indicator">Saving...</span>}
      </div>

      <div className="structured-fields-grid">
        {/* Relationship State — primary Hunter signal */}
        <FieldSelector
          label="Relationship State"
          options={RELATIONSHIP_STATES}
          value={contact.relationship_state || null}
          onChange={(val) => handleFieldChange('relationship_state', val)}
          wide
        />

        {/* Relationship Type */}
        <FieldSelector
          label="Relationship"
          options={RELATIONSHIP_TYPES}
          value={contact.relationship_type || null}
          onChange={(val) => handleFieldChange('relationship_type', val)}
        />

        {/* Strategic Value */}
        <FieldSelector
          label="Strategic Value"
          options={STRATEGIC_VALUES}
          value={contact.strategic_value || null}
          onChange={(val) => handleFieldChange('strategic_value', val)}
        />
      </div>
    </div>
  );
}

function FieldSelector({ label, options, value, onChange, wide }) {
  return (
    <div className={`sf-field ${wide ? 'sf-field-wide' : ''}`}>
      <span className="sf-field-label">{label}</span>
      <div className="sf-options">
        {options.map((option) => (
          <button
            key={option.id}
            className={`sf-option-btn ${value === option.id ? 'sf-option-active' : ''}`}
            onClick={() => onChange(option.id)}
            title={option.description}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
