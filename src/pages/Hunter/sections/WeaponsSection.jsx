import { useState } from 'react';
import { Mail, MessageSquare, Calendar, Zap, Phone, Share2, Video } from 'lucide-react';
import EmailWeapon from '../weapons/EmailWeapon';
import TextWeapon from '../weapons/TextWeapon';
import './WeaponsSection.css';

/**
 * HUNTER WEAPON ROOM - Weapons Section
 *
 * Purpose: Central hub for building different message types
 * Philosophy: Weapon-first approach - user chooses weapon, then builds message
 *
 * Weapons Available:
 * - Email (Intro + Follow-up) ✅
 * - Text Message (SMS) ✅
 * - LinkedIn Message (Future)
 * - LinkedIn Post (Future)
 * - Phone Call (Future)
 * - Video Message (Future)
 * - Event Invite (Future)
 */

const WEAPONS = [
  {
    id: 'email',
    name: 'Email',
    icon: Mail,
    description: 'Cold intro or follow-up email',
    available: true,
    types: ['Intro Email', 'Follow-Up Email']
  },
  {
    id: 'text',
    name: 'Text Message',
    icon: Zap,
    description: 'SMS outreach',
    available: true,
    types: ['Intro Text', 'Follow-Up Text']
  },
  {
    id: 'linkedin-dm',
    name: 'LinkedIn Message',
    icon: MessageSquare,
    description: 'Direct message or InMail',
    available: false,
    types: ['Connection Request', 'Direct Message']
  },
  {
    id: 'linkedin-post',
    name: 'LinkedIn Post',
    icon: Share2,
    description: 'Public post or article',
    available: false,
    types: ['Thought Leadership', 'Company Update']
  },
  {
    id: 'phone',
    name: 'Phone Call',
    icon: Phone,
    description: 'Cold call or follow-up',
    available: false,
    types: ['Cold Call', 'Follow-Up Call']
  },
  {
    id: 'video',
    name: 'Video Message',
    icon: Video,
    description: 'Loom or recorded video',
    available: false,
    types: ['Intro Video', 'Demo Video']
  },
  {
    id: 'event',
    name: 'Event Invite',
    icon: Calendar,
    description: 'Calendar invitation',
    available: false,
    types: ['Meeting Invite', 'Webinar Invite']
  }
];

export default function WeaponsSection() {
  const [selectedWeapon, setSelectedWeapon] = useState(null);

  if (selectedWeapon) {
    // Render weapon builder
    if (selectedWeapon === 'email') {
      return (
        <EmailWeapon
          onBack={() => setSelectedWeapon(null)}
        />
      );
    }

    if (selectedWeapon === 'text') {
      return (
        <TextWeapon
          onBack={() => setSelectedWeapon(null)}
        />
      );
    }

    // Future weapons
    return (
      <div className="weapon-builder">
        <button
          className="btn-back-weapon"
          onClick={() => setSelectedWeapon(null)}
        >
          ← Back to Weapons
        </button>
        <div className="hunter-empty-state">
          <div className="hunter-empty-icon">
            <Zap className="w-10 h-10 text-purple-400" />
          </div>
          <h3 className="hunter-empty-title">Coming Soon</h3>
          <p className="hunter-empty-text">
            This weapon is under development. Stay tuned!
          </p>
        </div>
      </div>
    );
  }

  // Weapon selection screen
  return (
    <div className="weapons-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Choose Your Weapon</h2>
          <p className="section-description">
            Select a channel to start building your outreach mission
          </p>
        </div>
      </div>

      <div className="weapons-grid">
        {WEAPONS.map(weapon => {
          const Icon = weapon.icon;
          return (
            <div
              key={weapon.id}
              className={`weapon-card ${!weapon.available ? 'weapon-disabled' : ''}`}
              onClick={() => weapon.available && setSelectedWeapon(weapon.id)}
            >
              <div className="weapon-card-header">
                <div className="weapon-icon">
                  <Icon className="w-6 h-6" />
                </div>
                {!weapon.available && (
                  <span className="weapon-badge-soon">Soon</span>
                )}
              </div>

              <h3 className="weapon-name">{weapon.name}</h3>
              <p className="weapon-description">{weapon.description}</p>

              <div className="weapon-types">
                {weapon.types.map((type, idx) => (
                  <span key={idx} className="weapon-type-tag">
                    {type}
                  </span>
                ))}
              </div>

              {weapon.available && (
                <div className="weapon-card-footer">
                  <span className="weapon-action">Build Message →</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
