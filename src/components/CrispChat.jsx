import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const CRISP_WEBSITE_ID = import.meta.env.VITE_CRISP_WEBSITE_ID;

// Routes where the chat widget must not appear
// Barry owns Mission Control — Crisp must not appear there
const EXCLUDED_PATHS = ['/', '/login', '/signup', '/forgot-password', '/mission-control-v2'];

const CrispChat = ({ user }) => {
  const location = useLocation();
  const sessionListenerAdded = useRef(false);

  const isExcluded =
    EXCLUDED_PATHS.includes(location.pathname) ||
    location.pathname.startsWith('/onboarding') ||
    location.pathname.startsWith('/checkout');

  useEffect(() => {
    if (!CRISP_WEBSITE_ID) return;

    // Ensure the pre-load queue exists
    window.$crisp = window.$crisp || [];
    window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;

    if (!user || isExcluded) {
      // Hide if Crisp is already loaded; otherwise queue the command
      window.$crisp.push(['do', 'chat:hide']);
      return;
    }

    // user is fully resolved here — push identity BEFORE the script tag is
    // appended so it is guaranteed to be in the queue when Crisp first reads it.
    if (user.email) {
      window.$crisp.push(['set', 'user:email', [user.email]]);
    }
    if (user.name) {
      window.$crisp.push(['set', 'user:nickname', [user.name]]);
    }

    // Safety net: re-apply identity once Crisp's session is fully ready.
    // This handles the cached-script edge case where Crisp can initialise
    // and drain the queue before our push above lands.
    if (!sessionListenerAdded.current) {
      sessionListenerAdded.current = true;
      window.$crisp.push(['on', 'session:loaded', () => {
        if (user.email) {
          window.$crisp.push(['set', 'user:email', [user.email]]);
        }
        if (user.name) {
          window.$crisp.push(['set', 'user:nickname', [user.name]]);
        }
      }]);
    }

    window.$crisp.push(['do', 'chat:show']);

    // Load the Crisp script only once
    if (!document.getElementById('crisp-chat-script')) {
      const s = document.createElement('script');
      s.id = 'crisp-chat-script';
      s.src = 'https://client.crisp.chat/l.js';
      s.async = true;
      document.head.appendChild(s);
    }
  }, [user, isExcluded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};

export default CrispChat;
