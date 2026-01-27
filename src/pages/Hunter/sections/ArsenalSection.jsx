import { FileText } from 'lucide-react';
import TemplateLibrary from '../../../components/hunter/TemplateLibrary';
import './ArsenalSection.css';

/**
 * HUNTER WEAPON ROOM - Arsenal Section
 *
 * Purpose: Manage message templates
 * Philosophy: Central template repository organized by type/intent
 */

export default function ArsenalSection() {
  return (
    <div className="arsenal-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Message Arsenal</h2>
          <p className="section-description">
            Save and reuse proven message templates
          </p>
        </div>
      </div>

      <div className="arsenal-content">
        <TemplateLibrary
          onSelectTemplate={null} // No selection in Arsenal view - just management
          selectedIntent={null}
        />
      </div>
    </div>
  );
}
