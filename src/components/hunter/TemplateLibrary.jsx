import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, FileText, X, Search, Crosshair, Target, Home, RotateCcw, Loader, ArrowRight, Sparkles } from 'lucide-react';
import { auth } from '../../firebase/config';
import { BRAND } from '../../theme/tokens';
import { ASSETS } from '../../theme/tokens';
import './TemplateLibrary.css';
import { getEffectiveUser } from '../../context/ImpersonationContext';

/**
 * ARSENAL: Template Library — Stage-Organized
 *
 * Templates organized by pipeline stage (Scout, Hunter, Sniper, Basecamp, Fallback).
 * Barry AI can generate templates conversationally within each stage context.
 */

// Stage tab configuration
const STAGE_TABS = [
  { id: 'all',       label: 'All',          icon: FileText, color: '#8b5cf6' },
  { id: 'scout',     label: 'Scout',        icon: Search,   color: '#e8197d' },
  { id: 'hunter',    label: 'Hunter',       icon: Crosshair, color: '#7c3aed' },
  { id: 'sniper',    label: 'Sniper',       icon: Target,   color: '#14b8a6' },
  { id: 'basecamp',  label: 'Basecamp',     icon: Home,     color: '#22c55e' },
  { id: 'fallback',  label: 'Fallback',     icon: RotateCcw, color: '#f59e0b' },
];

// Stage-specific starter templates
const STAGE_STARTER_TEMPLATES = {
  scout: [
    {
      icon: '🔍',
      name: 'Cold ICP Intro',
      subject: 'Quick question about [CompanyName]\'s approach to [Topic]',
      body: `Hi [FirstName],

I've been researching companies in [Industry] and [CompanyName] caught my eye — particularly [specific observation about their business].

I'm building a tool that helps businesses like yours [value prop in 1 sentence]. I'd love to get your take on it.

Would you be open to a quick 10-minute call this week?

[YourName]`,
      intent: 'cold',
      stage: 'scout',
    },
    {
      icon: '👋',
      name: 'Warm Mutual Connection',
      subject: 'Quick intro — [MutualConnection] suggested we connect',
      body: `Hi [FirstName],

[MutualConnection] mentioned you might be a great person to talk to about [Topic]. I've been working on [what you do] and thought there could be some interesting overlap.

Would love to grab 15 minutes to swap notes. What does your calendar look like this week?

[YourName]`,
      intent: 'warm',
      stage: 'scout',
    },
    {
      icon: '🎯',
      name: 'Event / Content Follow-Up',
      subject: 'Loved your take on [Topic]',
      body: `Hi [FirstName],

I saw your [post/talk/comment] about [Topic] — really resonated with me, especially the part about [specific detail].

I'm working on something related and would love to get your perspective. Quick 10-minute call?

[YourName]`,
      intent: 'warm',
      stage: 'scout',
    },
  ],
  hunter: [
    {
      icon: '📬',
      name: 'Direct Value Prop',
      subject: 'Helping [CompanyName] with [pain point]',
      body: `Hi [FirstName],

I work with [similar companies/role] who struggle with [pain point]. We've helped them [specific result] in [timeframe].

I have a few ideas that might work for [CompanyName]. Worth a 15-minute call to explore?

[YourName]`,
      intent: 'cold',
      stage: 'hunter',
    },
    {
      icon: '🔄',
      name: 'Follow-Up Nudge',
      subject: 'Re: [Previous Subject]',
      body: `Hi [FirstName],

Just circling back on my note from last week. I know things get busy.

The short version: I think I can help [CompanyName] [specific benefit]. Happy to prove it in 15 minutes.

If now isn't the right time, no worries — just let me know and I'll check back later.

[YourName]`,
      intent: 'followup',
      stage: 'hunter',
    },
    {
      icon: '💔',
      name: 'Breakup / Final Touch',
      subject: 'Should I close the loop?',
      body: `Hi [FirstName],

I've reached out a couple of times and haven't heard back — totally understand if the timing isn't right.

I'll assume this isn't a priority for now and won't reach out again. But if anything changes, my door is always open.

Wishing you and [CompanyName] the best.

[YourName]`,
      intent: 'followup',
      stage: 'hunter',
    },
  ],
  sniper: [
    {
      icon: '🎯',
      name: 'Post-Demo Follow-Up',
      subject: 'Great demo today — next steps',
      body: `Hi [FirstName],

Thanks for taking the time today — really enjoyed walking through [what was discussed]. A few key takeaways:

- [Key point 1 they were excited about]
- [Key point 2 — how it solves their pain]
- [Next step / action item]

I'll [your action] by [date]. In the meantime, here's [link/resource] we discussed.

Looking forward to moving this forward!

[YourName]`,
      intent: 'hot',
      stage: 'sniper',
    },
    {
      icon: '📋',
      name: 'Proposal / Pricing Follow-Up',
      subject: 'Proposal recap + next steps',
      body: `Hi [FirstName],

Following up on the proposal I sent over. Here's a quick recap of what we discussed:

- [Package/tier they're considering]
- [Key terms or timeline]
- [ROI or value justification]

Any questions or adjustments needed? Happy to hop on a quick call to finalize.

[YourName]`,
      intent: 'hot',
      stage: 'sniper',
    },
    {
      icon: '🤝',
      name: 'Decision-Maker Nudge',
      subject: 'Quick update for [DecisionMaker]',
      body: `Hi [FirstName],

I know you're evaluating a few options right now. I wanted to share one more thing that might help the decision:

[Social proof, case study, or ROI data point]

Happy to answer any remaining questions from you or your team. What's the best way to move this to the finish line?

[YourName]`,
      intent: 'hot',
      stage: 'sniper',
    },
  ],
  basecamp: [
    {
      icon: '🤝',
      name: 'Onboarding Welcome',
      subject: 'Welcome aboard — here\'s how to get started',
      body: `Hi [FirstName],

Welcome to the team! I'm thrilled to have [CompanyName] on board.

Here's your quick-start plan:
1. [Step 1 — e.g., Set up your account]
2. [Step 2 — e.g., Schedule onboarding call]
3. [Step 3 — e.g., Invite your team]

I'll be your main point of contact. Don't hesitate to reach out with any questions — I'm here to make sure you get maximum value.

[YourName]`,
      intent: 'onboarding',
      stage: 'basecamp',
    },
    {
      icon: '📊',
      name: 'Quarterly Check-In',
      subject: 'Quick check-in — how\'s everything going?',
      body: `Hi [FirstName],

It's been a few weeks since we last connected and I wanted to check in. Here are some things I noticed:

- [Usage/engagement observation]
- [New feature or update they might benefit from]

Any feedback or areas where we can improve? Would love to jump on a quick call to discuss.

[YourName]`,
      intent: 'followup',
      stage: 'basecamp',
    },
    {
      icon: '🌟',
      name: 'Referral Ask',
      subject: 'Quick favor — know anyone who\'d benefit?',
      body: `Hi [FirstName],

I hope you're loving [product/service] so far! Since things have been going well, I wanted to ask:

Do you know anyone else in your network who might benefit from what we do? I'd love an intro if so — and of course, I'll make sure they get the VIP treatment.

No pressure at all. Just thought I'd ask!

[YourName]`,
      intent: 'warm',
      stage: 'basecamp',
    },
  ],
  fallback: [
    {
      icon: '🔄',
      name: 'Win-Back — New Value',
      subject: 'Things have changed — worth another look?',
      body: `Hi [FirstName],

I know it's been a while since we last spoke, and I wanted to reach out because some things have changed on our end:

- [New feature or improvement]
- [New pricing or offer]
- [New result or case study]

Would you be open to a quick catch-up? I think you'd be pleasantly surprised.

[YourName]`,
      intent: 'warm',
      stage: 'fallback',
    },
    {
      icon: '💭',
      name: 'Feedback Request',
      subject: 'Quick question — what could we have done better?',
      body: `Hi [FirstName],

I noticed [CompanyName] moved on from us a while back, and I completely respect that decision.

I'm always trying to improve, and your feedback would be incredibly valuable. What was the main reason things didn't work out? Anything we could have done differently?

No pitch, just genuinely curious. A 5-minute call or even a quick reply would mean a lot.

[YourName]`,
      intent: 'followup',
      stage: 'fallback',
    },
    {
      icon: '👀',
      name: 'Re-Engagement Teaser',
      subject: 'Something I thought you\'d want to see',
      body: `Hi [FirstName],

Hope you're doing well! I came across something that made me think of you and [CompanyName]:

[Relevant insight, industry news, or new capability]

Thought it might be worth sharing. If you're curious, I'm happy to walk you through what's new.

[YourName]`,
      intent: 'warm',
      stage: 'fallback',
    },
  ],
};

export default function TemplateLibrary({ onSelectTemplate, selectedIntent, initialStage }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState(initialStage || 'all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStage, setCreateStage] = useState('scout');
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    subject: '',
    body: '',
    intent: selectedIntent || 'cold',
    stage: 'hunter',
  });
  const [saving, setSaving] = useState(false);

  // Barry template generation state
  const [showBarryChat, setShowBarryChat] = useState(false);
  const [barryMessages, setBarryMessages] = useState([]);
  const [barryInput, setBarryInput] = useState('');
  const [barryLoading, setBarryLoading] = useState(false);
  const [barryHistory, setBarryHistory] = useState([]);
  const barryEndRef = useRef(null);
  const barryInputRef = useRef(null);

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    barryEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [barryMessages]);

  async function loadTemplates() {
    try {
      const user = getEffectiveUser();
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

  function openCreateModal(stage) {
    const stageToUse = stage && stage !== 'all' ? stage : 'scout';
    setCreateStage(stageToUse);
    setNewTemplate({
      name: '',
      subject: '',
      body: '',
      intent: selectedIntent || 'cold',
      stage: stageToUse,
    });
    setShowBarryChat(false);
    setBarryMessages([]);
    setBarryHistory([]);
    setBarryInput('');
    setShowCreateModal(true);
  }

  function openBarryChat(stageOverride) {
    setShowBarryChat(true);
    const stage = stageOverride || createStage;
    const stageLabel = STAGE_TABS.find(s => s.id === stage)?.label || 'Scout';
    setBarryMessages([{
      role: 'barry',
      content: `I'll help you create a ${stageLabel} template. What kind of email do you need? For example:\n\n• "Post-demo follow-up to get them to sign up"\n• "Cold intro for SaaS founders"\n• "Win-back email for churned customers"\n\nTell me what you want to say and I'll draft it for you.`,
    }]);
    setTimeout(() => barryInputRef.current?.focus(), 150);
  }

  async function sendToBarry(text) {
    const msg = (text || barryInput).trim();
    if (!msg || barryLoading) return;
    setBarryInput('');
    setBarryMessages(prev => [...prev, { role: 'user', content: msg }]);
    setBarryLoading(true);

    try {
      const user = getEffectiveUser();
      if (!user) return;
      const authToken = await user.getIdToken();

      const res = await fetch('/.netlify/functions/barryGenerateTemplate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authToken,
          userId: user.uid,
          stage: createStage,
          message: msg,
          conversationHistory: barryHistory,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setBarryMessages(prev => [...prev, { role: 'barry', content: data.response_text }]);
        setBarryHistory(data.updatedHistory || []);

        // If Barry generated a template, pre-fill the form
        if (data.template) {
          setNewTemplate({
            name: data.template.name || '',
            subject: data.template.subject || '',
            body: data.template.body || '',
            intent: data.template.intent || 'cold',
            stage: createStage,
          });
          setBarryMessages(prev => [...prev, {
            role: 'system',
            content: 'Template loaded into the form — review and save when ready!',
          }]);
        }
      } else {
        setBarryMessages(prev => [...prev, { role: 'barry', content: 'Something went wrong — try again.' }]);
      }
    } catch (err) {
      console.error('[BarryTemplate] error:', err);
      setBarryMessages(prev => [...prev, { role: 'barry', content: 'Something went wrong — try again.' }]);
    } finally {
      setBarryLoading(false);
    }
  }

  async function handleSaveTemplate() {
    if (!newTemplate.name.trim() || !newTemplate.subject.trim() || !newTemplate.body.trim()) {
      return;
    }

    setSaving(true);
    try {
      const user = getEffectiveUser();
      if (!user) return;

      const idToken = await user.getIdToken();
      const response = await fetch('/.netlify/functions/save-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          template: { ...newTemplate, stage: createStage }
        })
      });

      if (response.ok) {
        await loadTemplates();
        setShowCreateModal(false);
        setNewTemplate({ name: '', subject: '', body: '', intent: 'cold', stage: 'hunter' });
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
      const user = getEffectiveUser();
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

  // Filter templates by stage and intent
  const filteredTemplates = templates.filter(t => {
    if (activeStage !== 'all' && t.stage !== activeStage) return false;
    if (selectedIntent && t.intent !== selectedIntent) return false;
    return true;
  });

  // Get starters for current stage
  const currentStarters = activeStage !== 'all'
    ? (STAGE_STARTER_TEMPLATES[activeStage] || [])
    : [];

  const activeTab = STAGE_TABS.find(t => t.id === activeStage);

  if (loading) {
    return (
      <div className="template-library-loading">
        Loading templates...
      </div>
    );
  }

  return (
    <div className="template-library">
      {/* Header */}
      <div className="template-library-header">
        <div className="template-library-title">
          <FileText className="w-5 h-5" />
          <h3>Message Templates</h3>
        </div>
        <button
          className="btn-create-template"
          onClick={() => openCreateModal(activeStage)}
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {/* Stage Tabs */}
      <div className="template-stage-tabs">
        {STAGE_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeStage === tab.id;
          const count = tab.id === 'all'
            ? templates.length
            : templates.filter(t => t.stage === tab.id).length;
          return (
            <button
              key={tab.id}
              className={`template-stage-tab ${isActive ? 'active' : ''}`}
              style={{
                '--tab-color': tab.color,
                borderColor: isActive ? tab.color : 'transparent',
                background: isActive ? `${tab.color}12` : 'transparent',
              }}
              onClick={() => setActiveStage(tab.id)}
            >
              <Icon size={14} style={{ color: isActive ? tab.color : undefined }} />
              <span style={{ color: isActive ? tab.color : undefined }}>{tab.label}</span>
              {count > 0 && (
                <span
                  className="template-stage-count"
                  style={{
                    background: isActive ? `${tab.color}20` : undefined,
                    color: isActive ? tab.color : undefined,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Template Grid */}
      {filteredTemplates.length === 0 ? (
        <div className="template-library-empty">
          <FileText className="w-12 h-12 text-gray-400 mb-3" />
          <p className="text-gray-500">
            {activeStage === 'all'
              ? 'No templates yet'
              : `No ${activeTab?.label || ''} templates yet`}
          </p>
          <p className="text-sm text-gray-400">
            {activeStage !== 'all'
              ? `Create ${activeTab?.label} templates for this stage of your pipeline`
              : 'Create your first template to speed up outreach'}
          </p>

          {/* Stage-specific starters */}
          {currentStarters.length > 0 && (
            <div className="template-starters">
              <p className="template-starters-label">Quick start — click to create:</p>
              <div className="template-starters-grid">
                {currentStarters.map((st, i) => (
                  <button
                    key={i}
                    className="template-starter-chip"
                    data-intent={st.intent}
                    onClick={() => {
                      setCreateStage(activeStage);
                      setNewTemplate({ ...st });
                      setShowBarryChat(false);
                      setBarryMessages([]);
                      setBarryHistory([]);
                      setShowCreateModal(true);
                    }}
                  >
                    <span className="template-starter-icon">{st.icon}</span>
                    <span>{st.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Ask Barry button when empty */}
          <button
            className="btn-ask-barry-empty"
            onClick={() => {
              openCreateModal(activeStage);
              const stageToUse = activeStage && activeStage !== 'all' ? activeStage : 'scout';
              setTimeout(() => openBarryChat(stageToUse), 100);
            }}
            style={{ '--barry-color': activeTab?.color || '#8b5cf6' }}
          >
            <Sparkles size={16} />
            Ask Barry to create a template
          </button>
        </div>
      ) : (
        <div className="template-library-grid">
          {filteredTemplates.map(template => {
            const stageInfo = STAGE_TABS.find(s => s.id === template.stage);
            return (
              <div key={template.id} className="template-card">
                <div className="template-card-header">
                  <div className="template-card-title">
                    <div className="template-card-badges">
                      {template.stage && stageInfo && (
                        <span
                          className="template-stage-badge"
                          style={{
                            background: `${stageInfo.color}15`,
                            color: stageInfo.color,
                            border: `1px solid ${stageInfo.color}30`,
                          }}
                        >
                          {stageInfo.label}
                        </span>
                      )}
                      <span className="template-intent-badge" data-intent={template.intent}>
                        {template.intent}
                      </span>
                    </div>
                    <span className="template-name">{template.name}</span>
                    {template.createdAt && (
                      <span className="template-date">
                        {new Date(template.createdAt._seconds ? template.createdAt._seconds * 1000 : template.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
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
            );
          })}
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateModal && (
        <div className="template-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className={`template-modal ${showBarryChat ? 'template-modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="template-modal-header">
              <h3>Create New Template</h3>
              <div className="template-modal-header-actions">
                {!showBarryChat && (
                  <button className="btn-ask-barry" onClick={openBarryChat}>
                    <Sparkles size={14} />
                    Ask Barry
                  </button>
                )}
                <button
                  className="btn-close-modal"
                  onClick={() => setShowCreateModal(false)}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="template-modal-content">
              {/* Barry Chat Panel */}
              {showBarryChat && (
                <div className="barry-template-panel">
                  <div className="barry-template-header">
                    <div className="barry-template-header-left">
                      <div className="barry-avatar-mini" style={{
                        background: `linear-gradient(135deg, ${BRAND.pink}, ${STAGE_TABS.find(s => s.id === createStage)?.color || '#8b5cf6'})`,
                      }}>
                        <img
                          src={ASSETS.barryAvatar}
                          alt="Barry"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                          onError={e => { e.target.style.display = 'none'; e.target.parentNode.textContent = '🐻'; }}
                        />
                      </div>
                      <div>
                        <span className="barry-template-name">Barry</span>
                        <span className="barry-template-mode" style={{ color: STAGE_TABS.find(s => s.id === createStage)?.color }}>
                          TEMPLATE BUILDER
                        </span>
                      </div>
                    </div>
                    <button
                      className="btn-close-barry"
                      onClick={() => setShowBarryChat(false)}
                      title="Close Barry"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="barry-template-messages">
                    {barryMessages.map((msg, i) => (
                      msg.role === 'system' ? (
                        <div key={i} className="barry-template-system">{msg.content}</div>
                      ) : (
                        <div key={i} className={`barry-template-msg ${msg.role}`}>
                          <div className="barry-template-bubble">
                            {msg.content}
                          </div>
                        </div>
                      )
                    ))}
                    {barryLoading && (
                      <div className="barry-template-msg barry">
                        <div className="barry-template-bubble">
                          <Loader size={14} className="barry-spinner" />
                        </div>
                      </div>
                    )}
                    <div ref={barryEndRef} />
                  </div>

                  <div className="barry-template-input-row">
                    <textarea
                      ref={barryInputRef}
                      value={barryInput}
                      onChange={e => setBarryInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendToBarry();
                        }
                      }}
                      placeholder={barryLoading ? 'Barry is thinking...' : 'Describe what you need...'}
                      disabled={barryLoading}
                      rows={1}
                      className="barry-template-input"
                    />
                    <button
                      className="barry-template-send"
                      onClick={() => sendToBarry()}
                      disabled={barryLoading || !barryInput.trim()}
                      style={{
                        background: `linear-gradient(135deg, ${STAGE_TABS.find(s => s.id === createStage)?.color || '#8b5cf6'}, ${STAGE_TABS.find(s => s.id === createStage)?.color || '#8b5cf6'}cc)`,
                      }}
                    >
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}

              {/* Template Form */}
              <div className="template-modal-body">
                <div className="form-group">
                  <label>Stage</label>
                  <select
                    value={createStage}
                    onChange={(e) => setCreateStage(e.target.value)}
                    className="form-select"
                  >
                    {STAGE_TABS.filter(t => t.id !== 'all').map(tab => (
                      <option key={tab.id} value={tab.id}>{tab.label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Template Name</label>
                  <input
                    type="text"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    placeholder="e.g., Post-Demo Sign-Up Nudge"
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
                    <option value="thank_you">Thank You</option>
                    <option value="onboarding">Onboarding / Get Started</option>
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
                    rows={showBarryChat ? 8 : 12}
                    className="form-textarea"
                  />
                </div>
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
