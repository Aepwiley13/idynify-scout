import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import './CompanyLeads.css';

export default function CompanyLeads() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCompanyLeads();
  }, [companyId]);

  async function loadCompanyLeads() {
    try {
      const userId = auth.currentUser.uid;

      // Load company info
      const companyDoc = await getDoc(
        doc(db, 'users', userId, 'companies', companyId)
      );

      if (!companyDoc.exists()) {
        navigate('/scout/companies');
        return;
      }

      setCompany({ id: companyDoc.id, ...companyDoc.data() });

      // Load all contacts for this company
      const contactsQuery = query(
        collection(db, 'users', userId, 'contacts'),
        where('company_id', '==', companyId)
      );

      const contactsSnapshot = await getDocs(contactsQuery);
      const contactsList = contactsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setContacts(contactsList);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load company leads:', error);
      setLoading(false);
    }
  }

  function exportContactsCSV(contacts, companyName) {
    const headers = ['Name', 'Title', 'Email', 'Phone', 'LinkedIn', 'Status', 'Added Date'];

    const rows = contacts.map(contact => [
      contact.name,
      contact.title,
      contact.email || '',
      contact.phone || '',
      contact.linkedin_url || '',
      contact.status || 'active',
      new Date(contact.saved_at).toLocaleDateString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${companyName.replace(/[^a-z0-9]/gi, '_')}_contacts_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  }

  if (loading) {
    return <div className="loading">Loading contacts...</div>;
  }

  return (
    <div className="company-leads">
      {/* Breadcrumb Navigation */}
      <div className="breadcrumb">
        <button onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}>
          My Companies
        </button>
        <span>›</span>
        <button onClick={() => navigate(`/scout/company/${companyId}`)}>
          {company?.name}
        </button>
        <span>›</span>
        <span>Contacts</span>
      </div>

      {/* Company Header */}
      <div className="company-header-compact">
        <div className="company-logo-small">
          {company?.name.charAt(0).toUpperCase()}
        </div>
        <div className="company-info-compact">
          <h1>{company?.name}</h1>
          <p>{company?.industry} • {company?.location}</p>
        </div>
        <div className="header-actions">
          <button
            className="back-to-company-btn"
            onClick={() => navigate(`/scout/company/${companyId}`)}
          >
            ← Back to Company
          </button>
        </div>
      </div>

      {/* Contacts Header */}
      <div className="contacts-header">
        <h2>All Contacts ({contacts.length})</h2>
        <p>Approved contacts from {company?.name}</p>
      </div>

      {/* Contacts Grid */}
      {contacts.length === 0 ? (
        <div className="empty-state">
          <p>No contacts approved for this company yet.</p>
          <button
            className="add-contacts-btn"
            onClick={() => navigate(`/scout/company/${companyId}`)}
          >
            Scout+
          </button>
        </div>
      ) : (
        <div className="contacts-grid">
          {contacts.map(contact => (
            <div
              key={contact.id}
              className="contact-card"
              onClick={() => navigate(`/scout/contact/${contact.id}`)}
            >
              <div className="contact-card-header">
                <div className="contact-avatar">
                  {contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="contact-basic-info">
                  <h3>{contact.name}</h3>
                  <p className="contact-title">{contact.title}</p>
                </div>
              </div>

              <div className="contact-card-details">
                {contact.email && (
                  <div className="detail-row">
                    <span className="detail-icon">📧</span>
                    <span className="detail-text">{contact.email}</span>
                  </div>
                )}

                {contact.phone && (
                  <div className="detail-row">
                    <span className="detail-icon">📞</span>
                    <span className="detail-text">{contact.phone}</span>
                  </div>
                )}

                {contact.linkedin_url && (
                  <div className="detail-row">
                    <span className="detail-icon">💼</span>
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      LinkedIn Profile
                    </a>
                  </div>
                )}
              </div>

              <div className="contact-card-footer">
                <span className="status-badge">{contact.status || 'active'}</span>
                <span className="added-date">
                  Added {new Date(contact.saved_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions Footer */}
      <div className="actions-footer">
        <button
          className="export-btn"
          onClick={() => exportContactsCSV(contacts, company.name)}
        >
          📥 Export Contacts to CSV
        </button>

        <button
          className="add-more-btn"
          onClick={() => navigate(`/scout/company/${companyId}`)}
        >
          + Add More Contacts
        </button>
      </div>
    </div>
  );
}
