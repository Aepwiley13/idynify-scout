import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../firebase/config';
import { isUserAdmin } from '../utils/adminAuth';

/**
 * Protected route component for admin-only pages
 * Checks if user is authenticated AND has admin role
 */
export default function ProtectedAdminRoute({ children }) {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const checkAdminStatus = async () => {
      const currentUser = auth.currentUser;

      if (!currentUser) {
        setLoading(false);
        return;
      }

      setUser(currentUser);

      try {
        const adminStatus = await isUserAdmin(currentUser.uid);
        setIsAdmin(adminStatus);
      } catch (error) {
        console.error('Error checking admin status:', error);
        setIsAdmin(false);
      }

      setLoading(false);
    };

    // Check on mount
    checkAdminStatus();

    // Listen for auth state changes
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        checkAdminStatus();
      } else {
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#f9fafb'
      }}>
        <div style={{
          textAlign: 'center',
          color: '#6b7280'
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #e5e7eb',
            borderTop: '3px solid #3b82f6',
            borderRadius: '50%',
            margin: '0 auto 1rem',
            animation: 'spin 1s linear infinite'
          }}></div>
          <p>Verifying admin access...</p>
        </div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Not logged in - redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Logged in but not admin - redirect to main dashboard
  if (!isAdmin) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#f9fafb',
        padding: '2rem'
      }}>
        <div style={{
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <div style={{
            fontSize: '3rem',
            marginBottom: '1rem'
          }}>🔒</div>
          <h2 style={{
            fontSize: '1.5rem',
            fontWeight: '700',
            color: '#111827',
            marginBottom: '0.5rem'
          }}>Access Denied</h2>
          <p style={{
            color: '#6b7280',
            marginBottom: '1.5rem'
          }}>
            This page is restricted to administrators only.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              padding: '0.75rem 1.5rem',
              background: '#3b82f6',
              color: '#ffffff',
              textDecoration: 'none',
              borderRadius: '8px',
              fontWeight: '600',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.target.style.background = '#2563eb'}
            onMouseOut={(e) => e.target.style.background = '#3b82f6'}
          >
            Return to Dashboard
          </a>
        </div>
      </div>
    );
  }

  // Admin verified - render children
  return children;
}
