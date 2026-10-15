/**
 * No screen reaches the legacy business-card scanner, and nothing new can.
 *
 * Its endpoint is deprecated and stays deployed only while we confirm nothing
 * outside the repo calls it. Inside the repo the answer has to be "nothing",
 * and these tests keep it that way: the moment a file imports
 * BusinessCardCapture again, or anything other than that component names the
 * endpoint, this suite fails and asks why.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

vi.mock('../theme/ThemeContext', () => ({
  useT: () => ({ appBg: '#fff', navBg: '#fff', cardBg: '#fff', surface: '#fafafa', statBg: '#eee', border: '#ddd', text: '#111', textMuted: '#555', textFaint: '#888' }),
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => ({ uid: 'u1' }) }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(() => ({})), getDocs: vi.fn() }));
vi.mock('../firebase/config', () => ({ db: {} }));
vi.mock('../components/scout/ManualContactForm', () => ({ default: () => <div>manual</div> }));
vi.mock('../components/scout/CSVUpload', () => ({ default: () => <div>csv</div> }));
vi.mock('../components/scout/LinkedInLinkSearch', () => ({ default: () => <div>linkedin</div> }));
vi.mock('../pages/Scout/CompanySearch', () => ({ default: () => <div>company search</div> }));
vi.mock('../components/scout/BulkComposeModal', () => ({ default: () => <div>compose</div> }));
// If anything still rendered the legacy scanner, this is what would appear.
vi.mock('../components/scout/BusinessCardCapture', () => ({ default: () => <div>LEGACY SCANNER RENDERED</div> }));

import ScoutPlus from '../pages/Scout/ScoutPlus';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const LEGACY_COMPONENT = 'src/components/scout/BusinessCardCapture.jsx';
const LEGACY_ENDPOINT = 'netlify/functions/extractBusinessCard.js';

/** Every source file under `dir`, as [repo-relative path, contents]. */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'test', 'dist'].includes(entry.name)) continue;
      sources(full, out);
    } else if (/\.(m?js|jsx|ts|tsx|html)$/.test(entry.name)) {
      out.push([relative(repo, full), readFileSync(full, 'utf8')]);
    }
  }
  return out;
}

const APP = sources(resolve(repo, 'src'));
const SERVER = sources(resolve(repo, 'netlify/functions'));
const PUBLIC = [...sources(resolve(repo, 'public')), ['index.html', readFileSync(resolve(repo, 'index.html'), 'utf8')]];

function renderScoutPlusAsked(initialView) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/scout', search: '?tab=scout-plus', state: { initialView } }]}>
      <Routes>
        <Route path="/scout" element={<ScoutPlus />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Scout+ offers no way into the legacy scanner', () => {
  it('a navigation asking for the scanner view lands on the menu instead', () => {
    renderScoutPlusAsked('business-card');

    expect(screen.getByRole('heading', { level: 2, name: 'Scout+' })).toBeInTheDocument();
    expect(screen.queryByText('LEGACY SCANNER RENDERED')).not.toBeInTheDocument();
  });

  it('the Coming Soon card is still shown, and is not a control', () => {
    renderScoutPlusAsked();

    const title = screen.getByText('Scan Business Card');
    expect(screen.getByText('COMING SOON')).toBeInTheDocument();
    expect(title.closest('button, a, [role="button"]')).toBeNull();
  });

  it('the other deep-linkable views still open', () => {
    renderScoutPlusAsked('company-search');
    expect(screen.getByText('company search')).toBeInTheDocument();
  });

  it('"business-card" is not an accepted view', () => {
    const src = readFileSync(resolve(repo, 'src/pages/Scout/ScoutPlus.jsx'), 'utf8');
    const validViews = src.match(/const validViews = \[([^\]]*)\]/)[1];
    expect(validViews).not.toContain('business-card');
  });
});

describe('nothing in the codebase reaches the legacy flow', () => {
  it('no file imports BusinessCardCapture, statically or lazily', () => {
    for (const [path, src] of APP) {
      expect(src, `${path} imports the legacy scanner`).not.toMatch(
        /from\s+['"][^'"]*BusinessCardCapture(\.jsx)?['"]|import\(\s*['"][^'"]*BusinessCardCapture/,
      );
    }
  });

  it('only the legacy component names the legacy endpoint', () => {
    const callers = [...APP, ...SERVER, ...PUBLIC]
      .filter(([path, src]) => path !== LEGACY_ENDPOINT && /functions\/extractBusinessCard\b/.test(src))
      .map(([path]) => path);

    expect(callers).toEqual([LEGACY_COMPONENT]);
  });

  it('no server function imports or calls the legacy endpoint', () => {
    for (const [path, src] of SERVER) {
      if (path === LEGACY_ENDPOINT) continue;
      expect(src, `${path} reaches the legacy endpoint`).not.toMatch(/extractBusinessCard/);
    }
  });
});

describe('AddContactModal is kept, unused, and cannot open the scanner', () => {
  const MODAL = 'src/components/scout/AddContactModal.jsx';

  it('still exists — deleting dead UI is a separate cleanup', () => {
    expect(existsSync(resolve(repo, MODAL))).toBe(true);
  });

  it('is imported by nothing', () => {
    for (const [path, src] of APP) {
      expect(src, `${path} imports the deprecated AddContactModal`).not.toMatch(
        /from\s+['"][^'"]*\/AddContactModal(\.jsx)?['"]/,
      );
    }
  });

  it('has no business-card view of its own', () => {
    const src = readFileSync(resolve(repo, MODAL), 'utf8');
    expect(src).not.toContain('BusinessCardCapture');
    expect(src).not.toContain("'business-card'");
  });
});
