/**
 * Impersonation Banner
 *
 * Shows a prominent banner when an admin is impersonating a user.
 * Displays target user info, remaining time, and end session button.
 */

import React, { useState, useEffect } from 'react';
import { Eye, X, Clock, AlertTriangle } from 'lucide-react';
import { auth } from '../firebase/config';
import './ImpersonationBanner.css';

const ImpersonationBanner = ({ session, onEndSession }) => {
  const [remainingTime, setRemainingTime] = useState('');
  const [isExpiringSoon, setIsExpiringSoon] = useState(false);
  const [ending, setEnding] = useState(false);

  // Update remaining time every second
  useEffect(() => {
    if (!session || session.status !== 'active') {
      return;
    }

    const updateTime = () => {
      const expiresAt = new Date(session.expiresAt);
      const now = new Date();
      const remaining = expiresAt.getTime() - now.getTime();

      if (remaining <= 0) {
        setRemainingTime('Expired');
        setIsExpiringSoon(true);
        // Auto-refresh to end session
        if (onEndSession) {
          onEndSession();
        }
        return;
      }

      // Check if expiring in less than 5 minutes
      setIsExpiringSoon(remaining < 5 * 60 * 1000);

      // Format time
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);

      if (minutes > 0) {
        setRemainingTime(`${minutes}m ${seconds}s`);
      } else {
        setRemainingTime(`${seconds}s`);
      }
    };

    // Update immediately
    updateTime();

    // Update every second
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, [session, onEndSession]);

  const handleEndSession = async () => {
    if (!confirm('Are you sure you want to end this impersonation session?')) {
      return;
    }

    try {
      setEnding(true);

      const user = auth.currentUser;
      if (!user) {
        throw new Error('Not authenticated');
      }

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/adminEndImpersonation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ authToken })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to end impersonation session');
      }

      // Notify parent component
      if (onEndSession) {
        onEndSession();
      }

      // Reload page to clear impersonation state
      window.location.reload();

    } catch (error) {
      console.error('Error ending impersonation:', error);
      alert(`Failed to end impersonation: ${error.message}`);
    } finally {
      setEnding(false);
    }
  };

  if (!session || session.status !== 'active') {
    return null;
  }

  return (
    <div className={`impersonation-banner ${isExpiringSoon ? 'expiring-soon' : ''}`}>
      <div className="banner-content">
        <div className="banner-icon">
          {isExpiringSoon ? (
            <AlertTriangle className="w-5 h-5" />
          ) : (
            <Eye className="w-5 h-5" />
          )}
        </div>

        <div className="banner-info">
          <div className="banner-title">
            {isExpiringSoon ? 'Impersonation Session Expiring Soon!' : 'Viewing as User'}
          </div>
          <div className="banner-details">
            <span className="target-user">{session.targetUserEmail}</span>
            <span className="separator">•</span>
            <Clock className="w-3 h-3" />
            <span className="time-remaining">{remainingTime} remaining</span>
          </div>
        </div>

        <button
          onClick={handleEndSession}
          disabled={ending}
          className="end-session-btn"
          title="End Impersonation Session"
        >
          <X className="w-4 h-4" />
          {ending ? 'Ending...' : 'End Session'}
        </button>
      </div>

      {isExpiringSoon && (
        <div className="banner-warning">
          This session will automatically expire when the timer reaches zero. End it now or it will time out.
        </div>
      )}
    </div>
  );
};

export default ImpersonationBanner;
