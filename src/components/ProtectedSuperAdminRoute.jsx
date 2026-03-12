import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../firebase/config';
import { isSuperAdmin } from '../utils/adminAuth';

/**
 * Route guard for super admin–only pages.
 * Checks: authenticated + role === 'super_admin' in Firestore.
 */
export default function ProtectedSuperAdminRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const checkAccess = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setLoading(false);
        return;
      }
      setUser(currentUser);
      try {
        const ok = await isSuperAdmin(currentUser.uid);
        setAuthorized(ok);
      } catch {
        setAuthorized(false);
      }
      setLoading(false);
    };

    checkAccess();

    const unsubscribe = auth.onAuthStateChanged((u) => {
      if (u) {
        checkAccess();
      } else {
        setUser(null);
        setAuthorized(false);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #1e293b', borderTop: '3px solid #f59e0b', borderRadius: '50%', margin: '0 auto 1rem', animation: 'spin 1s linear infinite' }} />
          <p>Verifying super admin access...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!authorized) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f172a', padding: '2rem' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '0.5rem' }}>Access Denied</h2>
          <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
            This area is restricted to Super Admins only.
          </p>
          <a href="/admin" style={{ display: 'inline-block', padding: '0.75rem 1.5rem', background: '#f59e0b', color: '#0f172a', textDecoration: 'none', borderRadius: 8, fontWeight: 600 }}>
            Back to Admin
          </a>
        </div>
      </div>
    );
  }

  return children;
}
