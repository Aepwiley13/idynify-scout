import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ExternalLink } from 'lucide-react';
import HeroHeader from './HeroHeader';
import QuickActions from './QuickActions';
import ContactInfo from './ContactInfo';
import BarryContext from './BarryContext';
import HunterContactDrawer from '../hunter/HunterContactDrawer';
import './ContactSnapshot.css';

export default function ContactSnapshot({ contact, onClose, onUpdate, context = 'leads' }) {
  const navigate = useNavigate();
  const [hasScroll, setHasScroll] = useState(false);
  const [barryContext, setBarryContext] = useState(contact.barryContext || null);
  const [hunterDrawerOpen, setHunterDrawerOpen] = useState(false);
  const contentRef = useRef(null);

  // Scroll detection effect
  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const handleScroll = () => {
      const scrollTop = contentElement.scrollTop;
      const scrollHeight = contentElement.scrollHeight;
      const clientHeight = contentElement.clientHeight;

      setHasScroll(scrollHeight > clientHeight && scrollTop < scrollHeight - clientHeight - 20);
    };

    handleScroll();
    contentElement.addEventListener('scroll', handleScroll);

    const observer = new ResizeObserver(handleScroll);
    observer.observe(contentElement);

    return () => {
      contentElement.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [contact]);

  function handleOpenFullProfile() {
    onClose();
    navigate(`/scout/contact/${contact.id}`);
  }

  function handleContactUpdate(updatedContact) {
    if (onUpdate) {
      onUpdate(updatedContact);
    }
  }

  return (
    <div className="contact-snapshot-overlay" onClick={onClose}>
      <div className="contact-snapshot-container" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button className="close-button-absolute" onClick={onClose}>
          <X className="w-6 h-6" />
        </button>

        {/* Hero Header */}
        <HeroHeader contact={contact} size="compact" />

        {/* Content */}
        <div ref={contentRef} className={`contact-snapshot-content ${hasScroll ? 'has-scroll' : ''}`}>
          {/* Quick Actions Bar (Sticky) */}
          <QuickActions
            contact={contact}
            onHunter={() => setHunterDrawerOpen(true)}
          />

          {/* Contact Information (Compact) */}
          <ContactInfo contact={contact} mode="compact" />

          {/* Barry Context (Preview) */}
          <BarryContext
            barryContext={barryContext}
            mode="preview"
            onViewFullProfile={handleOpenFullProfile}
          />

          {/* Open Full Profile Button */}
          <div className="snapshot-footer">
            <button className="open-full-profile-btn" onClick={handleOpenFullProfile}>
              <ExternalLink className="w-5 h-5" />
              <span>Open Full Profile</span>
            </button>
          </div>
        </div>
      </div>

      {/* Hunter Contact Drawer - In-context engagement */}
      <HunterContactDrawer
        contact={contact}
        isOpen={hunterDrawerOpen}
        onClose={() => setHunterDrawerOpen(false)}
        onContactUpdate={handleContactUpdate}
      />
    </div>
  );
}
