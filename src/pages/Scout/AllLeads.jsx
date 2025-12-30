import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { useNavigate } from 'react-router-dom';
import './AllLeads.css';

export default function AllLeads() {
  const navigate = useNavigate();
  const [contacts, setContacts] = useState([]);
  const [companies, setCompanies] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadAllContacts();
  }, []);

  async function loadAllContacts() {
    try {
      const user = auth.currentUser;
      if (!user) {
        navigate('/login');
        return;
      }

      const userId = user.uid;
      console.log('🔍 Loading all contacts for user:', userId);

      // Load all companies first to get company names
      const companiesSnapshot = await getDocs(
        collection(db, 'users', userId, 'companies')
      );

      const companiesMap = {};
      companiesSnapshot.docs.forEach(doc => {
        companiesMap[doc.id] = doc.data();
      });
      setCompanies(companiesMap);

      console.log('📦 Loaded companies:', Object.keys(companiesMap).length);

      // Load all contacts
      const contactsSnapshot = await getDocs(
        collection(db, 'users', userId, 'contacts')
      );

      const contactsList = contactsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log('✅ Loaded contacts:', contactsList.length);

      setContacts(contactsList);
      setLoading(false);
    } catch (error) {
      console.error('❌ Failed to load contacts:', error);
      setLoading(false);
    }
  }

  function exportToCSV() {
    if (filteredContacts.length === 0) {
      alert('No contacts to export!');
      return;
    }

    // CSV headers
    const headers = ['Name', 'Title', 'Company', 'Email', 'Phone', 'LinkedIn', 'Added Date'];

    // CSV rows
    const rows = filteredContacts.map(contact => {
      const company = companies[contact.company_id];
      return [
        contact.name || '',
        contact.title || '',
        company?.name || 'Unknown Company',
        contact.email || '',
        contact.phone || '',
        contact.linkedin_url || '',
        contact.addedAt ? new Date(contact.addedAt).toLocaleDateString() : ''
      ].map(field => `"${field}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scout-contacts-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    console.log('📥 Exported', filteredContacts.length, 'contacts to CSV');
  }

  // Filter contacts based on search term
  const filteredContacts = contacts.filter(contact => {
    if (!searchTerm) return true;

    const company = companies[contact.company_id];
    const searchLower = searchTerm.toLowerCase();

    return (
      (contact.name || '').toLowerCase().includes(searchLower) ||
      (contact.title || '').toLowerCase().includes(searchLower) ||
      (company?.name || '').toLowerCase().includes(searchLower) ||
      (contact.email || '').toLowerCase().includes(searchLower)
    );
  });

  if (loading) {
    return (
      <div className="all-leads-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">[LOADING ALL CONTACTS...]</p>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">👥</div>
        <h2>No Contacts Yet</h2>
        <p>Contacts you select from companies will appear here</p>
        <p className="empty-hint">Go to Saved Companies and select contacts from your interested companies!</p>
      </div>
    );
  }

  return (
    <div className="all-leads">
      {/* Header with Stats */}
      <div className="section-header">
        <div>
          <h2>All Leads</h2>
          <p className="section-subtitle">
            {filteredContacts.length} {filteredContacts.length === 1 ? 'contact' : 'contacts'}
            {searchTerm && ` matching "${searchTerm}"`}
          </p>
        </div>

        <button className="export-btn" onClick={exportToCSV}>
          📥 Export to CSV
        </button>
      </div>

      {/* Search Bar */}
      <div className="search-container">
        <input
          type="text"
          className="search-input"
          placeholder="🔍 Search by name, title, company, or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button
            className="clear-search-btn"
            onClick={() => setSearchTerm('')}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* Contacts Table */}
      <div className="table-container">
        <table className="contacts-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Title</th>
              <th>Company</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Added</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {filteredContacts.map(contact => {
              const company = companies[contact.company_id];
              return (
                <tr key={contact.id}>
                  <td className="contact-name">
                    <div className="avatar">
                      {contact.name ? contact.name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <span>{contact.name || 'Unknown'}</span>
                  </td>
                  <td className="contact-title">{contact.title || '—'}</td>
                  <td className="company-name">{company?.name || 'Unknown Company'}</td>
                  <td className="contact-email">
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`} onClick={(e) => e.stopPropagation()}>
                        {contact.email}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="contact-phone">{contact.phone || '—'}</td>
                  <td className="added-date">
                    {contact.addedAt ? new Date(contact.addedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="contact-links">
                    {contact.linkedin_url && (
                      <a
                        href={contact.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link-btn"
                        onClick={(e) => e.stopPropagation()}
                      >
                        💼
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredContacts.length === 0 && searchTerm && (
        <div className="no-results">
          <p>No contacts found matching "{searchTerm}"</p>
          <button className="clear-btn" onClick={() => setSearchTerm('')}>
            Clear Search
          </button>
        </div>
      )}
    </div>
  );
}
