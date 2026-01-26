import { useState, useEffect } from 'react';
import { Plus, Trash2, FileText, X } from 'lucide-react';
import { auth } from '../../firebase/config';
import './TemplateLibrary.css';

/**
 * HUNTER PHASE 2: Template Library
 *
 * Purpose: Save and reuse message structures for faster campaign creation
 * Philosophy: Templates are starting points, not automation. User always controls final message.
 *
 * Features:
 * - Save templates with subject + body structure
 * - Tag templates by intent (cold/warm/hot/followup)
 * - Use template to pre-fill campaign messages
 * - Delete templates
 *
 * Non-automation: Templates are suggestions. User reviews/edits before sending.
 */

export default function TemplateLibrary({ onSelectTemplate, selectedIntent }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    subject: '',
    body: '',
    intent: selectedIntent || 'cold'
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const idToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/get-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });

      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveTemplate() {
    if (!newTemplate.name.trim() || !newTemplate.subject.trim() || !newTemplate.body.trim()) {
      return;
    }

    setSaving(true);
    try {
      const user = auth.currentUser;
      if (!user) return;

      const idToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/save-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          template: newTemplate
        })
      });

      if (response.ok) {
        await loadTemplates();
        setShowCreateModal(false);
        setNewTemplate({
          name: '',
          subject: '',
          body: '',
          intent: selectedIntent || 'cold'
        });
      }
    } catch (error) {
      console.error('Failed to save template:', error);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTemplate(templateId) {
    if (!confirm('Delete this template?')) return;

    try {
      const user = auth.currentUser;
      if (!user) return;

      const idToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/delete-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, templateId })
      });

      if (response.ok) {
        await loadTemplates();
      }
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  }

  const filteredTemplates = selectedIntent
    ? templates.filter(t => t.intent === selectedIntent)
    : templates;

  if (loading) {
    return (
      <div className="template-library-loading">
        Loading templates...
      </div>
    );
  }

  return (
    <div className="template-library">
      <div className="template-library-header">
        <div className="template-library-title">
          <FileText className="w-5 h-5" />
          <h3>Message Templates</h3>
        </div>
        <button
          className="btn-create-template"
          onClick={() => setShowCreateModal(true)}
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {filteredTemplates.length === 0 ? (
        <div className="template-library-empty">
          <FileText className="w-12 h-12 text-slate-600 mb-3" />
          <p className="text-slate-400">No templates yet</p>
          <p className="text-sm text-slate-500">Create your first template to speed up campaign creation</p>
        </div>
      ) : (
        <div className="template-library-grid">
          {filteredTemplates.map(template => (
            <div key={template.id} className="template-card">
              <div className="template-card-header">
                <div className="template-card-title">
                  <span className="template-intent-badge" data-intent={template.intent}>
                    {template.intent}
                  </span>
                  <span className="template-name">{template.name}</span>
                </div>
                <button
                  className="btn-delete-template"
                  onClick={() => handleDeleteTemplate(template.id)}
                  title="Delete template"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="template-card-preview">
                <div className="template-subject">
                  <strong>Subject:</strong> {template.subject}
                </div>
                <div className="template-body">
                  {template.body.substring(0, 150)}
                  {template.body.length > 150 ? '...' : ''}
                </div>
              </div>
              {onSelectTemplate && (
                <button
                  className="btn-use-template"
                  onClick={() => onSelectTemplate(template)}
                >
                  Use This Template
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateModal && (
        <div className="template-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="template-modal" onClick={(e) => e.stopPropagation()}>
            <div className="template-modal-header">
              <h3>Create New Template</h3>
              <button
                className="btn-close-modal"
                onClick={() => setShowCreateModal(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="template-modal-body">
              <div className="form-group">
                <label>Template Name</label>
                <input
                  type="text"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  placeholder="e.g., Enterprise Cold Intro"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>Engagement Intent</label>
                <select
                  value={newTemplate.intent}
                  onChange={(e) => setNewTemplate({ ...newTemplate, intent: e.target.value })}
                  className="form-select"
                >
                  <option value="cold">Cold</option>
                  <option value="warm">Warm</option>
                  <option value="hot">Hot</option>
                  <option value="followup">Follow-up</option>
                </select>
              </div>

              <div className="form-group">
                <label>Subject Line</label>
                <input
                  type="text"
                  value={newTemplate.subject}
                  onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
                  placeholder="Quick question about [topic]"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>Message Body</label>
                <textarea
                  value={newTemplate.body}
                  onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })}
                  placeholder="Hi [FirstName],&#10;&#10;I noticed [observation]...&#10;&#10;[Your message here]"
                  rows={12}
                  className="form-textarea"
                />
              </div>
            </div>

            <div className="template-modal-footer">
              <button
                className="btn-cancel"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-save-template"
                onClick={handleSaveTemplate}
                disabled={saving || !newTemplate.name.trim() || !newTemplate.subject.trim() || !newTemplate.body.trim()}
              >
                {saving ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
