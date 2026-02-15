import { Mail, MessageSquare, Linkedin, Phone } from 'lucide-react';

/**
 * GameWeaponSelector — Channel picker for sending.
 *
 * Mirrors HunterContactDrawer.jsx:782-822 weapon grid.
 * Channels disabled based on contact data availability.
 *
 * Default selection logic (new — G1 compliant, pure UI):
 *   1. If contact.email && gmailConnected → EMAIL
 *   2. Else if contact.linkedin_url → LINKEDIN
 *   3. Else if contact.email → EMAIL (native mailto)
 *   4. Else → no default
 *
 * G9: Horizontal row of icon buttons, min 44x44px.
 */

const WEAPONS = [
  {
    id: 'email',
    label: 'Email',
    icon: Mail,
    check: (contact) => !!(contact?.email && contact.email.trim()),
    disabledLabel: 'No email'
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    icon: Linkedin,
    check: (contact) => !!contact?.linkedin_url,
    disabledLabel: 'No profile'
  },
  {
    id: 'text',
    label: 'Text',
    icon: MessageSquare,
    check: (contact) => !!(contact?.phone || contact?.phone_mobile),
    disabledLabel: 'No phone'
  },
  {
    id: 'call',
    label: 'Call',
    icon: Phone,
    check: (contact) => !!(contact?.phone || contact?.phone_mobile),
    disabledLabel: 'No phone'
  }
];

/**
 * Determine the default weapon based on contact data and Gmail status.
 */
export function getDefaultWeapon(contact, gmailConnected) {
  const hasEmail = contact?.email && contact.email.trim();
  const hasLinkedIn = !!contact?.linkedin_url;

  if (hasEmail && gmailConnected) return 'email';
  if (hasLinkedIn) return 'linkedin';
  if (hasEmail) return 'email';
  return null;
}

export default function GameWeaponSelector({ contact, selectedWeapon, onSelect, gmailConnected }) {
  return (
    <div className="game-weapon-selector">
      <p className="game-weapon-label">Send via</p>
      <div className="game-weapon-grid">
        {WEAPONS.map((weapon) => {
          const Icon = weapon.icon;
          const available = weapon.check(contact);
          const isSelected = selectedWeapon === weapon.id;

          // Badge logic mirrors HunterContactDrawer
          let badge = null;
          if (weapon.id === 'email' && available && gmailConnected) {
            badge = 'Gmail';
          } else if (weapon.id === 'email' && available) {
            badge = 'Opens App';
          } else if (available && weapon.id !== 'email') {
            badge = 'Opens App';
          }

          return (
            <button
              key={weapon.id}
              className={`game-weapon-btn ${isSelected ? 'selected' : ''} ${!available ? 'disabled' : ''}`}
              onClick={() => available && onSelect(weapon.id)}
              disabled={!available}
            >
              <Icon className="w-5 h-5" />
              <span className="game-weapon-name">{weapon.label}</span>
              {!available && <span className="game-weapon-disabled">{weapon.disabledLabel}</span>}
              {badge && <span className="game-weapon-badge">{badge}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
