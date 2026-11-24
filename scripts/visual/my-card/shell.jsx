/**
 * My Card inside the application's real navigation, for looking at: the real
 * Sidebar and the real mobile BottomNav around the real page, laid out as
 * MainLayout lays them out (without its top bar). Firebase auth, the card
 * service and impersonation are stand-ins (vite.config.mjs); My People is a
 * plain placeholder, so nothing here loads anyone's contacts.
 *
 *   ?theme=workspace|mission   ?at=my-card|people
 */
import '../../../src/index.css';
import '../../../src/components/layout/MainLayout.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MyCardPage from '../../../src/pages/ContactHub/MyCardPage';
import Sidebar from '../../../src/components/layout/Sidebar';
import BottomNav from '../../../src/components/layout/BottomNav';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get('theme') === 'mission' ? 'mission' : 'workspace';
const start = params.get('at') === 'people' ? '/contact-hub' : '/contact-hub/my-card';

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MemoryRouter initialEntries={[start]}>
      <div className="main-layout shell-fixed-height sidebar-wide">
        <Sidebar user={{ email: 'ada@example.test', displayName: 'Ada Lovelace' }} onLogout={() => {}} />
        <div className="main-content">
          <main className="page-content page-content-full">
            <div className="fx-content">
              <Routes>
                <Route path="/contact-hub/my-card" element={<MyCardPage />} />
                <Route path="*" element={<p style={{ padding: 32 }}>My People (placeholder)</p>} />
              </Routes>
            </div>
          </main>
        </div>
        <BottomNav onOpenMore={() => {}} />
      </div>
    </MemoryRouter>
  </StrictMode>,
);
(async () => {
  for (let i = 0; i < 80 && !document.querySelector('.mycard form, .mycard [role="alert"], .mycard [role="status"], .hub-sidenav'); i += 1) await wait(100);
  await wait(500);
  document.documentElement.dataset.ready = '1';
})();
