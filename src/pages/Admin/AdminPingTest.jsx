import { useState, useEffect } from 'react';
import { auth } from '../../firebase/config';

export default function AdminPingTest() {
  const [status, setStatus] = useState('Testing connection...');
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    testConnection();
  }, []);

  const testConnection = async () => {
    try {
      const adminApiBase = import.meta.env.VITE_ADMIN_API_BASE;

      if (!adminApiBase) {
        setStatus('❌ VITE_ADMIN_API_BASE not configured');
        return;
      }

      const endpoint = `${adminApiBase}/adminPing`;

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        setStatus(`❌ Connection failed: ${response.status} ${response.statusText}`);
        return;
      }

      const data = await response.json();

      if (data.ok === true) {
        setStatus('✅ Admin Connected');
        setConnected(true);
      } else {
        setStatus('❌ Unexpected response');
      }
    } catch (error) {
      setStatus(`❌ Error: ${error.message}`);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000',
      color: '#fff',
      fontFamily: 'monospace'
    }}>
      <div style={{
        textAlign: 'center',
        padding: '2rem',
        border: connected ? '2px solid #0f0' : '2px solid #f00',
        borderRadius: '8px',
        maxWidth: '600px'
      }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>
          Admin Dashboard Test
        </h1>
        <p style={{ fontSize: '1.5rem', margin: '2rem 0' }}>
          {status}
        </p>
        <div style={{ fontSize: '0.875rem', color: '#666', marginTop: '2rem' }}>
          <p>Endpoint: {import.meta.env.VITE_ADMIN_API_BASE}/adminPing</p>
        </div>
      </div>
    </div>
  );
}
