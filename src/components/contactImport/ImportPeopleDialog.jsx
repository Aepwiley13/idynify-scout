/**
 * Import people from a CSV file into My People (Free and paid accounts alike).
 *
 * This is the existing contact importer (components/scout/CSVUpload.jsx ContactCsvImport over
 * services/csvImportService.js), opened from Contact Hub with Contact Hub's words. Nothing about
 * the import changes:
 *
 *   - it writes the canonical contact records, users/{uid}/contacts, the collection My People
 *     and Scout both read, so a Free account that upgrades keeps every imported person;
 *   - people already in the account are matched by the shared identity rules and updated, never
 *     duplicated, and nothing already on a record is overwritten;
 *   - parsing, matching and writing happen in the browser and Firestore. Free accounts
 *     skip optional background company-name correction.
 *
 * Laid out like My People's Add Person dialog (ContactHub.css .hub-dialog).
 */
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useAccountPlan } from '../billing/accountPlanContext';
import { isPaidPlan } from '../../utils/accountPlan';
import { useT } from '../../theme/ThemeContext';
import { ContactCsvImport } from '../scout/CSVUpload';
import { HUB_IMPORT_COPY } from './importPeople';

export default function ImportPeopleDialog({ onClose, onImported }) {
  const T = useT();
  const correctCompanyName = isPaidPlan(useAccountPlan());
  const titleId = useId();
  const boxRef = useRef(null);
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement);

  useEffect(() => {
    boxRef.current?.querySelector('button, input')?.focus();
    const previous = opener.current;
    return () => { previous?.focus?.(); };
  }, []);

  function onKeyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
  }

  return (
    <>
      <div className="hub-dialog-backdrop" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="hub-dialog"
        style={{ background: T.cardBg, color: T.text, borderColor: T.border }}
        onKeyDown={onKeyDown}
      >
        <div className="hub-dialog-head">
          <h2 id={titleId} className="hub-dialog-title">Import Contacts</h2>
          <button type="button" className="hub-icon-btn hub-icon-btn--plain" aria-label="Close" onClick={onClose} style={{ color: T.textMuted }}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <ContactCsvImport
          copy={HUB_IMPORT_COPY}
          correctCompanyName={correctCompanyName}
          onCancel={onClose}
          onContactsAdded={(_items, result) => onImported(result)}
        />
      </div>
    </>
  );
}
