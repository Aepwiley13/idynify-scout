/**
 * BARRY'S MARKDOWN RENDERS WITHOUT THROWING (#745).
 *
 * react-markdown 10 rejects props it removed in v9 — `className` among them —
 * by calling devlop's `unreachable`. In a development build that throws:
 *
 *   Unexpected `className` prop, remove it (see …#remove-classname)
 *
 * and because Barry's chat panel is mounted on every page of the layout, every
 * such page rendered blank under `npm run dev` (and in any test that rendered
 * these components). A production build compiles `unreachable` to a no-op, so
 * production never crashed: it silently dropped the classes instead.
 *
 * The fix keeps production output as it is. The chat panel and the email
 * draft card wrap the markdown in a div that carries the classes (the change
 * react-markdown's changelog documents; measured identical with the production
 * CSS). Barry Workspace drops `barry-workspace-prose`, which has never applied
 * in production; turning it on would change how replies look.
 *
 * These render each affected surface with the real react-markdown (not
 * mocked) and fail on the code before the fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const turns = vi.hoisted(() => ({ current: [] }));
const USER = vi.hoisted(() => ({ uid: 'u1', getIdToken: async () => 't' }));

vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: USER } }));
vi.mock('firebase/firestore', () => ({
  doc: (...path) => ({ path: path.slice(1).join('/') }),
  collection: vi.fn(() => ({})), query: vi.fn(() => ({})), where: vi.fn(),
  getDoc: vi.fn(async (ref) => ({
    exists: () => ref?.path === 'users/u1',
    data: () => (ref?.path === 'users/u1' ? { onboardingComplete: true, name: 'Aaron' } : undefined),
  })),
  getDocs: vi.fn(async () => ({ docs: [], empty: true, size: 0, forEach: () => {} })),
  setDoc: vi.fn(async () => {}), addDoc: vi.fn(async () => ({ id: 'x' })), updateDoc: vi.fn(async () => {}),
  serverTimestamp: () => null,
}));
vi.mock('../context/ImpersonationContext', () => ({ getEffectiveUser: () => USER }));
vi.mock('../context/ShellContext', () => ({ useShell: () => ({ barryOpen: true, closeBarry: () => {}, setFirstExperience: () => {} }) }));
vi.mock('../theme/ThemeContext', () => ({ useT: () => new Proxy({}, { get: () => '#555555' }) }));
vi.mock('../utils/barryCanonical', () => ({
  loadOrSeedRecentTurns: vi.fn(async () => turns.current),
  appendTurn: vi.fn(async () => {}),
}));
vi.mock('../utils/barryContextStack', () => ({ buildContextStack: vi.fn(async () => ({})) }));
// Neighbours of the markdown that have nothing to do with it.
vi.mock('../components/shared/MessageAngleBlock', () => ({ default: () => null }));
vi.mock('../components/barry/BarryResultSet', () => ({ default: () => <div data-testid="result-set" /> }));
vi.mock('../components/barry/BarryResolutionPreview', () => ({ default: () => <div data-testid="resolution-preview" /> }));
vi.mock('../hooks/useFirstExperienceController', () => ({ default: () => ({ phase: 'loading', turns: [] }) }));
vi.mock('../hooks/useOnboardingState', () => ({ useOnboardingState: () => ({ barryState: null, companiesFoundCount: 0 }) }));
vi.mock('../pages/Onboarding/BarryOnboarding', () => ({ default: () => null }));
vi.mock('../components/onboarding/RelationshipFirstValue', () => ({ default: () => null }));
vi.mock('../components/onboarding/CompanyResultsCard', () => ({ default: () => null }));

const { EmailDraftCard } = await import('../components/shared/EmailDraftCard.jsx');
const { default: BarryChatPanel } = await import('../components/dashboard/BarryChatPanel.jsx');
const { default: BarryWorkspace } = await import('../pages/Barry/BarryWorkspace.jsx');

// Markdown with the pieces Barry uses: emphasis, a list, two paragraphs.
const md = (lead) => `${lead} **three** companies:\n\n- Sokol Studio\n- Wasatch Front Advisors\n\nWant an intro?`;
const strongs = (container) => [...container.querySelectorAll('strong')].map(s => s.textContent);

beforeEach(() => {
  turns.current = [];
  sessionStorage.clear();
  globalThis.fetch = vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).includes('barryOrientationBrief')
      ? { success: true, brief: 'Your **pipeline** is ready.', suggestedPrompts: [] }
      : { success: true }),
  }));
});

describe('the email draft card', () => {
  it('renders its markdown preamble, with the classes on a wrapper', () => {
    const { container } = render(<EmailDraftCard preamble={md('Here are')} subject="Intro" body="Hi Kristin" contactName="Kristin" userId="u1" />);
    expect(strongs(container)).toContain('three');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    const wrapper = container.querySelector('strong').closest('.prose');
    expect(wrapper.className).toBe('prose prose-sm max-w-none [&>p]:mt-0 [&>p:last-child]:mb-0');
  });
});

describe("Barry's chat panel (mounted on every page of the layout)", () => {
  it('renders the opening brief and an assistant message as markdown', async () => {
    turns.current = [
      { role: 'user', content: 'Who should I look at?' },
      { role: 'assistant', content: md('I found') },
    ];
    const { container } = render(<BarryChatPanel userId="u1" kpiContextReady />);
    await waitFor(() => expect(strongs(container)).toEqual(expect.arrayContaining(['pipeline', 'three'])));
    for (const word of ['pipeline', 'three']) {
      const strong = [...container.querySelectorAll('strong')].find(s => s.textContent === word);
      expect(strong.closest('.prose').className).toBe('prose prose-invert prose-sm max-w-none [&>p]:mt-0 [&>p:last-child]:mb-0');
    }
  });

  it('renders the fallback brief when the brief cannot load', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ success: false }) }));
    render(<BarryChatPanel userId="u1" kpiContextReady />);
    expect(await screen.findByText('Your pipeline is ready. Tell me what you want to work on.')).toBeInTheDocument();
  });
});

describe('Barry Workspace (/barry)', () => {
  it('renders every kind of assistant turn as markdown: plain, result set, preview and other cards', async () => {
    turns.current = [
      { role: 'user', content: 'Find me companies' },
      { role: 'assistant', content: md('Plain: I found') },
      { role: 'assistant', kind: 'result_set', content: md('Result set:'), meta: { sessionRef: 's1' } },
      { role: 'assistant', kind: 'resolution_preview', content: md('Preview:'), meta: { sessionRef: 's2' } },
      { role: 'assistant', kind: 'angles', content: md('Angles:') },
    ];
    const { container } = render(<MemoryRouter initialEntries={['/barry']}><BarryWorkspace /></MemoryRouter>);
    await waitFor(() => expect(container.querySelectorAll('strong')).toHaveLength(4));
    expect(container.querySelectorAll('li')).toHaveLength(8);
    expect(screen.getByTestId('result-set')).toBeInTheDocument();
    expect(screen.getByTestId('resolution-preview')).toBeInTheDocument();
    // Production never applied this class; the fix keeps it that way.
    expect(container.querySelector('.barry-workspace-prose')).toBeNull();
  });
});

describe('no react-markdown element anywhere in src gets a prop react-markdown 10 rejects', () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  // The removed props, read from the installed react-markdown itself.
  const lib = readFileSync(resolve(repo, 'node_modules/react-markdown/lib/index.js'), 'utf8');
  const removed = [...lib.slice(lib.indexOf('const deprecations')).matchAll(/from: '(\w+)'/g)].map(m => m[1]);

  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') walk(p); } else if (/\.(jsx?|tsx?)$/.test(e.name)) files.push(p);
    }
  };
  walk(resolve(repo, 'src'));

  it('reads the list of removed props (className among them)', () => {
    expect(removed).toContain('className');
    expect(removed.length).toBeGreaterThan(10);
  });

  it('no <ReactMarkdown …> or <Markdown …> passes one', () => {
    const offenders = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (!/from ['"]react-markdown['"]/.test(src)) continue;
      const name = src.match(/import (\w+) from ['"]react-markdown['"]/)?.[1] || 'ReactMarkdown';
      for (const m of src.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))) {
        for (const prop of removed) {
          if (new RegExp(`\\b${prop}\\s*=`).test(m[1])) offenders.push(`${file.slice(repo.length + 1)}: ${prop}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
