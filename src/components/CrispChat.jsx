import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const CRISP_WEBSITE_ID = import.meta.env.VITE_CRISP_WEBSITE_ID;

// Routes where the chat widget must not appear
const EXCLUDED_PATHS = ['/', '/login', '/signup', '/forgot-password'];

const CrispChat = ({ user }) => {
  const location = useLocation();

  const isExcluded =
    EXCLUDED_PATHS.includes(location.pathname) ||
    location.pathname.startsWith('/onboarding') ||
    location.pathname.startsWith('/checkout');

  // Load the Crisp script once when the component first mounts
  useEffect(() => {
    if (!CRISP_WEBSITE_ID) return;

    window.$crisp = window.$crisp || [];
    window.CRISP_WEBSITE_ID = CRISP_WEBSITE_ID;

    if (!document.getElementById('crisp-chat-script')) {
      const script = document.createElement('script');
      script.id = 'crisp-chat-script';
      script.src = 'https://client.crisp.chat/l.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  // Set user identity and show/hide the widget based on current route
  useEffect(() => {
    if (!window.$crisp) return;

    if (user && !isExcluded) {
      window.$crisp.push(['set', 'user:email', [user.email]]);
      if (user.name) {
        window.$crisp.push(['set', 'user:nickname', [user.name]]);
      }
      window.$crisp.push(['do', 'chat:show']);
    } else {
      window.$crisp.push(['do', 'chat:hide']);
    }
  }, [user, isExcluded]);

  return null;
};

export default CrispChat;
