import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowLeft, ExternalLink, CheckCircle } from 'lucide-react';
import HeroHeader from './HeroHeader';
import QuickActions from './QuickActions';
import ContactInfo from './ContactInfo';
import BarryContext from './BarryContext';
import FindContact from '../scout/FindContact';
import './ContactSnapshot.css';

export default function ContactSnapshot({ contact, onClose, onUpdate, context = 'leads' }) {
  const navigate = useNavigate();
  const [isEnrichmentMode, setIsEnrichmentMode] = useState(false);
  const [enrichSuccess, setEnrichSuccess] = useState(false);
  const [hasScroll, setHasScroll] = useState(false);
  const [barryContext, setBarryContext] = useState(contact.barryContext || null);
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
  }, [contact, isEnrichmentMode]);

  function handleEnrichContact() {
    setIsEnrichmentMode(true);
  }

  function handleEnrichmentComplete(contacts) {
    if (contacts && contacts.length > 0) {
      setEnrichSuccess(true);
      setTimeout(() => setEnrichSuccess(false), 3000);

      if (onUpdate) {
        onUpdate(contacts[0]);
      }
      setIsEnrichmentMode(false);
    }
  }

  function handleCancelEnrichment() {
    setIsEnrichmentMode(false);
  }

  function handleOpenFullProfile() {
    onClose();
    navigate(`/scout/contact/${contact.id}`);
  }

  return (
    <div className="contact-snapshot-overlay" onClick={onClose}>
      <div className="contact-snapshot-container" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button className="close-button-absolute" onClick={onClose}>
          <X className="w-6 h-6" />
        </button>

        {/* Hero Header (not shown in enrichment mode) */}
        {!isEnrichmentMode && <HeroHeader contact={contact} size="compact" />}

        {/* Enrichment Mode Header */}
        {isEnrichmentMode && (
          <div className="contact-snapshot-header-simple">
            <div className="header-content">
              <button onClick={handleCancelEnrichment} className="back-button">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="header-text">
                <h2 className="snapshot-title">Enrich Contact</h2>
                <p className="snapshot-subtitle">Search for updated contact information</p>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {isEnrichmentMode ? (
          <div style={{ padding: '1.5rem' }}>
            <FindContact
              onContactAdded={handleEnrichmentComplete}
              onCancel={handleCancelEnrichment}
              initialSearchParams={{
                name: contact.name || '',
                company_name: contact.company_name || contact.company || ''
              }}
            />
          </div>
        ) : (
          <div ref={contentRef} className={`contact-snapshot-content ${hasScroll ? 'has-scroll' : ''}`}>
            {/* Quick Actions Bar (Sticky) */}
            <QuickActions contact={contact} onEnrich={handleEnrichContact} />

            {/* Success Banner */}
            {enrichSuccess && (
              <div className="success-banner">
                <CheckCircle className="w-5 h-5" />
                <span>Contact enriched successfully! Email and phone updated.</span>
              </div>
            )}

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
        )}
      </div>
    </div>
  );
}
