import { useState, useEffect } from 'react';
import { auth, db } from '../../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { Brain, MessageSquare, Check, Clock, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import './BarryConversationsView.css';

export default function BarryConversationsView({ userId, userEmail }) {
  const [loading, setLoading] = useState(true);
  const [conversation, setConversation] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadBarryConversation();
  }, [userId]);

  const loadBarryConversation = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch Barry ICP conversation
      const conversationDoc = await getDoc(
        doc(db, 'users', userId, 'barryConversations', 'icp')
      );

      if (conversationDoc.exists()) {
        setConversation(conversationDoc.data());
      } else {
        setConversation(null);
      }
    } catch (err) {
      console.error('Error loading Barry conversation:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return (
          <span className="barry-status-badge completed">
            <Check className="w-3 h-3" />
            Completed
          </span>
        );
      case 'in_progress':
        return (
          <span className="barry-status-badge in-progress">
            <Clock className="w-3 h-3" />
            In Progress
          </span>
        );
      default:
        return (
          <span className="barry-status-badge unknown">
            <AlertTriangle className="w-3 h-3" />
            {status || 'Unknown'}
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="barry-conversations-view">
        <div className="section-header">
          <Brain className="section-icon" />
          <h2>Barry ICP Conversation</h2>
        </div>
        <div className="loading-state">Loading conversation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="barry-conversations-view">
        <div className="section-header">
          <Brain className="section-icon" />
          <h2>Barry ICP Conversation</h2>
        </div>
        <div className="error-state">Error: {error}</div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="barry-conversations-view">
        <div className="section-header">
          <Brain className="section-icon" />
          <h2>Barry ICP Conversation</h2>
        </div>
        <div className="empty-state">
          <MessageSquare className="w-8 h-8" />
          <p>No Barry conversation found for this user</p>
          <span className="empty-hint">User has not completed Barry ICP onboarding</span>
        </div>
      </div>
    );
  }

  const confidencePercent = Math.round((conversation.extractedICP?.confidenceScore || 0) * 100);

  return (
    <div className="barry-conversations-view">
      <div className="section-header">
        <Brain className="section-icon" />
        <h2>Barry ICP Conversation</h2>
        {getStatusBadge(conversation.status)}
      </div>

      {/* Summary Card */}
      <div className="conversation-summary">
        <div className="summary-grid">
          <div className="summary-item">
            <span className="summary-label">Status</span>
            <span className="summary-value">{conversation.status}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Started</span>
            <span className="summary-value">{formatDate(conversation.startedAt)}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Last Updated</span>
            <span className="summary-value">{formatDate(conversation.updatedAt)}</span>
          </div>
          {conversation.completedAt && (
            <div className="summary-item">
              <span className="summary-label">Completed</span>
              <span className="summary-value">{formatDate(conversation.completedAt)}</span>
            </div>
          )}
          <div className="summary-item">
            <span className="summary-label">Follow-ups Used</span>
            <span className="summary-value">{conversation.followUpCount || 0} / 3</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Confidence</span>
            <span className={`summary-value confidence-${confidencePercent >= 80 ? 'high' : confidencePercent >= 60 ? 'medium' : 'low'}`}>
              {confidencePercent}%
            </span>
          </div>
        </div>
      </div>

      {/* Extracted ICP */}
      {conversation.extractedICP && (
        <div className="extracted-icp">
          <h3>Extracted ICP</h3>
          <div className="icp-fields">
            <div className="icp-field">
              <span className="field-label">Industries</span>
              <span className="field-value">
                {conversation.extractedICP.industries?.length > 0
                  ? conversation.extractedICP.industries.join(', ')
                  : 'Not specified'}
              </span>
            </div>
            <div className="icp-field">
              <span className="field-label">Company Sizes</span>
              <span className="field-value">
                {conversation.extractedICP.companySizes?.length > 0
                  ? conversation.extractedICP.companySizes.join(', ')
                  : 'Any size'}
              </span>
            </div>
            <div className="icp-field">
              <span className="field-label">Locations</span>
              <span className="field-value">
                {conversation.extractedICP.locations === 'nationwide'
                  ? 'Nationwide'
                  : conversation.extractedICP.locations?.length > 0
                    ? conversation.extractedICP.locations.join(', ')
                    : 'Not specified'}
              </span>
            </div>
            <div className="icp-field">
              <span className="field-label">Target Titles</span>
              <span className="field-value">
                {conversation.extractedICP.targetTitles?.length > 0
                  ? conversation.extractedICP.targetTitles.join(', ')
                  : 'Any role'}
              </span>
            </div>
            {conversation.extractedICP.rawInput && (
              <div className="icp-field full-width">
                <span className="field-label">Raw User Input</span>
                <span className="field-value raw-input">"{conversation.extractedICP.rawInput}"</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conversation Messages (Expandable) */}
      {conversation.messages && conversation.messages.length > 0 && (
        <div className="conversation-messages">
          <button
            className="expand-toggle"
            onClick={() => setExpanded(!expanded)}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Conversation History ({conversation.messages.length} messages)</span>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {expanded && (
            <div className="messages-list">
              {conversation.messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`message-item ${msg.role === 'barry' ? 'barry' : 'user'}`}
                >
                  <div className="message-header">
                    <span className="message-role">
                      {msg.role === 'barry' ? '🧠 Barry' : '👤 User'}
                    </span>
                    <span className="message-time">
                      {formatDate(msg.timestamp)}
                    </span>
                  </div>
                  <div className="message-content">
                    {msg.content.split('\n').map((line, i) => (
                      <p key={i}>{line || '\u00A0'}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Source */}
      <div className="conversation-footer">
        <span className="source-label">Source: {conversation.source || 'Unknown'}</span>
      </div>
    </div>
  );
}
