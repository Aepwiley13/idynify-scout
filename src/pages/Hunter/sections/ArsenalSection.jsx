import { FileText } from 'lucide-react';
import TemplateLibrary from '../../../components/hunter/TemplateLibrary';
import './ArsenalSection.css';

/**
 * ARSENAL - Message Templates Library
 *
 * Stage-organized template management with Barry AI generation.
 * Templates are grouped by pipeline stage (Scout, Hunter, Sniper, Basecamp, Fallback).
 */

export default function ArsenalSection() {
  return (
    <div className="arsenal-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Message Arsenal</h2>
          <p className="section-description">
            Save and reuse proven message templates — organized by pipeline stage
          </p>
        </div>
      </div>

      <div className="arsenal-content">
        <TemplateLibrary
          onSelectTemplate={null}
          selectedIntent={null}
        />
      </div>
    </div>
  );
}
