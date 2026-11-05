import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { auth } from './client/firebaseConfig.js';
import { ThemeProvider, useT } from '@repo/theme/ThemeContext';
import { ImpersonationProvider } from '@repo/context/ImpersonationContext';
import AllLeads from '@repo/pages/Scout/AllLeads';
import ContactProfile from '@repo/pages/Scout/ContactProfile';

const q = new URLSearchParams(window.location.search);
const as = q.get('as') ?? 'qa-beta';
const page = q.get('s') ?? 'people';
const viewAs = q.get('viewAs');
const viewAsDelay = Number(q.get('viewAsDelay') ?? 0);

function Shell({ children }) {
  const T = useT();
  document.body.style.background = T.appBg;
  // Block wrapper, like MainLayout's .page-content (a flex wrapper changes the page's width).
  return <div style={{ minHeight: '100vh', color: T.text }}>{children}</div>;
}

function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(viewAs && !viewAsDelay ? { status: 'active', targetUserId: viewAs, adminUserId: as } : null);
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    if (!u || u.uid !== as) {
      if (u) await signOut(auth);
      await signInWithEmailAndPassword(auth, `${as}@example.test`, 'Staging-QA-2026!');
      return;
    }
    setReady(true);
  }), []);
  useEffect(() => {
    if (!viewAs || !viewAsDelay) return undefined;
    const t = setTimeout(() => setSession({ status: 'active', targetUserId: viewAs, adminUserId: as }), viewAsDelay);
    return () => clearTimeout(t);
  }, []);
  if (!ready) return <p>signing in as {as}…</p>;
  return (
    <ImpersonationProvider session={session}>
      <Shell>
        <span className="who" data-testid="who">{as}{session ? ` viewing as ${session.targetUserId}` : ''}</span>
        {page === 'profile' ? (
          <MemoryRouter initialEntries={[`/contact/${q.get('id') ?? 'c01'}`]}>
            <Routes><Route path="/contact/:contactId" element={<ContactProfile />} /></Routes>
          </MemoryRouter>
        ) : (
          <MemoryRouter><AllLeads mode={page === 'scout' ? 'scout' : 'people'} /></MemoryRouter>
        )}
      </Shell>
    </ImpersonationProvider>
  );
}

createRoot(document.getElementById('root')).render(<ThemeProvider><App /></ThemeProvider>);
