import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, addDoc, query, where, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { X, Target, Plus, Zap, Mail, MessageSquare, Phone, Edit2, Check } from 'lucide-react';
import { getAllGoals } from '../../utils/missionTemplates';
import './HunterContactDrawer.css';

/**
 * HUNTER CONTACT DRAWER
 *
 * In-context Hunter experience inside contact profile.
 * User never leaves the contact - all Hunter actions happen here.
 *
 * Features:
 * - Add to existing mission
 * - Create new mission with this contact
 * - Send one-off message
 * - Edit contact info inline
 * - See missions they're in
 */

export default function HunterContactDrawer({ contact, isOpen, onClose, onContactUpdate }) {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState('main'); // main, add-to-mission, create-mission, quick-message, edit-info
  const [missions, setMissions] = useState([]);
  const [contactMissions, setContactMissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editedContact, setEditedContact] = useState(contact);

  useEffect(() => {
    if (isOpen) {
      loadMissions();
      setEditedContact(contact);
    }
  }, [isOpen, contact]);

  async function loadMissions() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      // Load all active missions
      const missionsRef = collection(db, 'users', user.uid, 'missions');
      const missionsSnapshot = await getDocs(missionsRef);

      const missionsList = missionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).filter(m => m.status === 'autopilot' || m.status === 'draft');

      setMissions(missionsList);

      // Find missions this contact is already in
      const inMissions = missionsList.filter(mission =>
        mission.contacts?.some(c => c.contactId === contact.id)
      );
      setContactMissions(inMissions);
    } catch (error) {
      console.error('Error loading missions:', error);
    }
  }

  async function handleAddToMission(missionId) {
    setLoading(true);
    try {
      const user = auth.currentUser;
      const mission = missions.find(m => m.id === missionId);

      // Add contact to mission
      const updatedContacts = [
        ...(mission.contacts || []),
        {
          contactId: contact.id,
          name: `${contact.firstName} ${contact.lastName}`,
          email: contact.email || null,
          phone: contact.phone || null,
          currentStepIndex: 0,
          lastTouchDate: null,
          status: 'active',
          outcomes: []
        }
      ];

      await updateDoc(doc(db, 'users', user.uid, 'missions', missionId), {
        contacts: updatedContacts,
        updatedAt: new Date().toISOString()
      });

      alert(`${contact.firstName} added to mission!`);
      loadMissions();
      setActiveView('main');
    } catch (error) {
      console.error('Error adding to mission:', error);
      alert('Failed to add to mission. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveContactInfo() {
    setLoading(true);
    try {
      const user = auth.currentUser;
      await updateDoc(doc(db, 'users', user.uid, 'contacts', contact.id), {
        email: editedContact.email,
        phone: editedContact.phone,
        updatedAt: new Date().toISOString()
      });

      onContactUpdate(editedContact);
      alert('Contact info updated!');
      setActiveView('main');
    } catch (error) {
      console.error('Error updating contact:', error);
      alert('Failed to update contact. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleCreateMissionWithContact() {
    // Navigate to create mission with this contact pre-selected
    navigate(`/hunter/create-mission?contactId=${contact.id}`);
    onClose();
  }

  if (!isOpen) return null;

  const goals = getAllGoals();
  const hasEmail = contact.email && contact.email.trim() !== '';
  const hasPhone = contact.phone && contact.phone.trim() !== '';

  return (
    <div className="hunter-contact-drawer-overlay" onClick={onClose}>
      <div className="hunter-contact-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-title-section">
            <Target className="w-6 h-6 text-purple-400" />
            <div>
              <h2 className="drawer-title">Hunter</h2>
              <p className="drawer-subtitle">
                {contact.firstName} {contact.lastName}
              </p>
            </div>
          </div>
          <button className="btn-close-drawer" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="drawer-content">
          {/* Main View */}
          {activeView === 'main' && (
            <div className="drawer-main-view">
              {/* Contact Info Status */}
              <div className="contact-info-status">
                <div className="info-item">
                  <Mail className="w-4 h-4" />
                  <span>{hasEmail ? contact.email : 'No email'}</span>
                  {!hasEmail && (
                    <button
                      className="btn-add-info"
                      onClick={() => setActiveView('edit-info')}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  )}
                </div>
                <div className="info-item">
                  <Phone className="w-4 h-4" />
                  <span>{hasPhone ? contact.phone : 'No phone'}</span>
                  {!hasPhone && (
                    <button
                      className="btn-add-info"
                      onClick={() => setActiveView('edit-info')}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  )}
                </div>
                <button
                  className="btn-edit-info"
                  onClick={() => setActiveView('edit-info')}
                >
                  <Edit2 className="w-4 h-4" />
                  Edit Info
                </button>
              </div>

              {/* Current Missions */}
              {contactMissions.length > 0 && (
                <div className="drawer-section">
                  <h3 className="section-title">Active Missions</h3>
                  <div className="missions-list">
                    {contactMissions.map(mission => (
                      <div key={mission.id} className="mission-item">
                        <div className="mission-item-header">
                          <span className="mission-name">{mission.name}</span>
                          <span className="mission-goal">{mission.goalName}</span>
                        </div>
                        <div className="mission-item-status">
                          <Zap className="w-3 h-3" />
                          <span>
                            {mission.contacts?.find(c => c.contactId === contact.id)?.currentStepIndex || 0} / {mission.steps?.length || 0} steps
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="drawer-section">
                <h3 className="section-title">Quick Actions</h3>
                <div className="action-buttons">
                  <button
                    className="action-btn primary"
                    onClick={handleCreateMissionWithContact}
                  >
                    <Plus className="w-5 h-5" />
                    <span>Create New Mission</span>
                  </button>

                  {missions.length > 0 && (
                    <button
                      className="action-btn secondary"
                      onClick={() => setActiveView('add-to-mission')}
                    >
                      <Target className="w-5 h-5" />
                      <span>Add to Existing Mission</span>
                    </button>
                  )}

                  <button
                    className="action-btn secondary"
                    onClick={() => setActiveView('quick-message')}
                  >
                    <MessageSquare className="w-5 h-5" />
                    <span>Send One-Off Message</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add to Mission View */}
          {activeView === 'add-to-mission' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                ← Back
              </button>
              <h3 className="view-title">Add to Existing Mission</h3>
              <div className="missions-list">
                {missions.map(mission => (
                  <div
                    key={mission.id}
                    className="mission-select-item"
                    onClick={() => handleAddToMission(mission.id)}
                  >
                    <div className="mission-info">
                      <span className="mission-name">{mission.name}</span>
                      <span className="mission-goal">{mission.goalName}</span>
                    </div>
                    <div className="mission-stats">
                      <span>{mission.contacts?.length || 0} contacts</span>
                      <span>•</span>
                      <span>{mission.steps?.filter(s => s.enabled !== false).length || 0} steps</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Edit Info View */}
          {activeView === 'edit-info' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                ← Back
              </button>
              <h3 className="view-title">Edit Contact Info</h3>
              <div className="edit-form">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={editedContact.email || ''}
                    onChange={(e) => setEditedContact({ ...editedContact, email: e.target.value })}
                    placeholder="email@example.com"
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    value={editedContact.phone || ''}
                    onChange={(e) => setEditedContact({ ...editedContact, phone: e.target.value })}
                    placeholder="+1 (555) 123-4567"
                    className="form-input"
                  />
                </div>
                <button
                  className="btn-primary-hunter"
                  onClick={handleSaveContactInfo}
                  disabled={loading}
                >
                  <Check className="w-5 h-5" />
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {/* Quick Message View */}
          {activeView === 'quick-message' && (
            <div className="drawer-view">
              <button className="btn-back" onClick={() => setActiveView('main')}>
                ← Back
              </button>
              <h3 className="view-title">Send One-Off Message</h3>
              <p className="view-description">
                Quick actions coming soon: Email, SMS, LinkedIn message
              </p>
              <div className="quick-message-options">
                <button className="quick-message-btn" disabled>
                  <Mail className="w-5 h-5" />
                  <span>Send Email</span>
                </button>
                <button className="quick-message-btn" disabled>
                  <MessageSquare className="w-5 h-5" />
                  <span>Send SMS</span>
                </button>
                <button className="quick-message-btn" disabled>
                  <Phone className="w-5 h-5" />
                  <span>Schedule Call</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
