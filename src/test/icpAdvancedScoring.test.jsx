/**
 * #006.9 — ICP scoring weights live in a collapsed "Advanced: How Matches Are
 * Scored" section. Presentation only: the same values, defaults, save payload
 * and validation (the four weights must total 100) as before.
 *
 * Same in-memory Firestore harness as icpSaveFeedback.test.jsx.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, fireEvent, act, waitFor, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, beforeEach, expect } from 'vitest';

// ── In-memory Firestore ─────────────────────────────────────────────────────

const STORE = new Map();

const pathOf = (first, rest) =>
  (first && first.__path ? [first.__path, ...rest] : rest).join('/');

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Firestore merge semantics, flat — no nested field paths are used here. */
function write(path, data, options) {
  const next = options?.merge ? { ...(STORE.get(path) || {}), ...clone(data) } : clone(data);
  STORE.set(path, next);
}

vi.mock('firebase/firestore', () => ({
  collection: (first, ...rest) => ({ __path: pathOf(first, rest) }),
  doc: (first, ...rest) => {
    const p = pathOf(first, rest);
    return { __path: p, id: p.split('/').pop() };
  },
  getDoc: async ref => {
    const data = STORE.get(ref.__path);
    return { exists: () => data !== undefined, data: () => clone(data), id: ref.id };
  },
  getDocs: async q => {
    const prefix = q.__path + '/';
    const docs = [...STORE.entries()]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map(([k, v]) => ({ id: k.split('/').pop(), data: () => clone(v), ref: { __path: k, id: k.split('/').pop() } }));
    return { empty: docs.length === 0, docs };
  },
  setDoc: async (ref, data, options) => write(ref.__path, data, options),
  updateDoc: async (ref, data) => write(ref.__path, data, { merge: true }),
  deleteDoc: async ref => { STORE.delete(ref.__path); },
  writeBatch: () => {
    const staged = [];
    return {
      set: (ref, data, options) => staged.push([ref.__path, data, options]),
      update: (ref, data) => staged.push([ref.__path, data, { merge: true }]),
      commit: async () => staged.forEach(([p, d, o]) => write(p, d, o)),
    };
  },
}));

// vi.mock factories are hoisted above every top-level binding, so the test
// user is built inside each one rather than shared from a const.
vi.mock('../firebase/config', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', getIdToken: () => Promise.resolve('token') } },
}));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'u1', getIdToken: () => Promise.resolve('token') }),
}));

// Leaf panels reach for their own data and are not part of this contract.
vi.mock('../components/scout/BarryICPPanel', () => ({ default: () => null, BarryAvatar: () => null }));
vi.mock('../components/icp/Section9MessagingFlow', () => ({ default: () => null }));

import ICPSettings from '../pages/Scout/ICPSettings.jsx';
import { DEFAULT_WEIGHTS } from '../utils/icpScoring';

// ── Fixtures ────────────────────────────────────────────────────────────────

const SAVED_WEIGHTS = { industry: 40, location: 30, employeeSize: 20, revenue: 10 };
const PROFILE = 'users/u1/icpProfiles/icp_a';

function seed(weights = SAVED_WEIGHTS) {
  STORE.clear();
  const criteria = {
    industries: ['Construction'], companySizes: ['11-20'], locations: ['Texas'],
    isNationwide: false, targetTitles: ['VP Sales'], scoringWeights: weights,
    foundedAgeRange: null, notes: '', messaging: { one: 'a' }, messagingProgress: 100,
  };
  STORE.set(PROFILE, {
    ...criteria, name: 'MANUFACTURING', isActive: true, status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  STORE.set('users/u1/companyProfile/current', {
    ...criteria, name: 'MANUFACTURING', icpId: 'icp_a', icpIdSource: 'active-selection',
    isActive: true, status: 'active',
  });
}

async function mountSettings() {
  const view = render(<MemoryRouter><ICPSettings /></MemoryRouter>);
  await screen.findByText('Save Changes');
  return view;
}

const click = async el => { await act(async () => { fireEvent.click(el); }); };
const toggle = () => screen.getByRole('button', { name: /Advanced: How Matches Are Scored/ });
const panel = () => document.getElementById('advanced-scoring-panel');
const FACTORS = [
  ['industry', 'Industry Match'],
  ['location', 'Location Match'],
  ['employeeSize', 'Employee Size Match'],
  ['revenue', 'Revenue Match'],
];
const numberInput = label => screen.getByLabelText(label, { selector: 'input[type="number"]' });
const searchCalls = () => fetch.mock.calls.filter(([u]) => String(u).includes('search-companies')).length;

beforeEach(() => {
  seed();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
});

describe('Advanced: How Matches Are Scored', () => {
  it('starts collapsed, with a visible heading and plain explanation', async () => {
    await mountSettings();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe('advanced-scoring-panel');
    expect(panel().hidden).toBe(true);
    expect(screen.getByText(
      'Adjust how important each factor is when Scout evaluates companies. Most users can leave these settings as they are.',
    )).toBeTruthy();
    // The old always-open heading is gone; nothing else is.
    expect(screen.queryByText('ICP Scoring Weights')).toBeNull();
  });

  it('expanding reveals all four controls with their saved values', async () => {
    await mountSettings();
    await click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(panel().hidden).toBe(false);
    for (const [key, label] of FACTORS) {
      expect(numberInput(label).value).toBe(String(SAVED_WEIGHTS[key]));
      expect(screen.getByLabelText(`${label} weight (slider)`).value).toBe(String(SAVED_WEIGHTS[key]));
    }
  });

  it('collapsing keeps edited values, and a valid save writes exactly them', async () => {
    await mountSettings();
    await click(toggle());
    fireEvent.change(numberInput('Industry Match'), { target: { value: '30' } });
    fireEvent.change(numberInput('Location Match'), { target: { value: '40' } });
    await click(toggle());
    expect(panel().hidden).toBe(true);
    await click(toggle());
    expect(numberInput('Industry Match').value).toBe('30');
    expect(numberInput('Location Match').value).toBe('40');

    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(STORE.get(PROFILE).scoringWeights)
      .toEqual({ industry: 30, location: 40, employeeSize: 20, revenue: 10 }));
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.queryByTestId('weights-total-error')).toBeNull();
  });

  it('a valid save with the section collapsed is unchanged: same weights, section stays closed', async () => {
    await mountSettings();
    fireEvent.click(screen.getByLabelText('51-100 employees'));
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(STORE.get(PROFILE).companySizes).toContain('51-100'));
    expect(STORE.get(PROFILE).scoringWeights).toEqual(SAVED_WEIGHTS);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('an invalid total blocks the save, opens the section, and moves focus to the message', async () => {
    await mountSettings();
    await click(toggle());
    fireEvent.change(numberInput('Industry Match'), { target: { value: '50' } }); // 110
    await click(toggle());                                                          // user closes it
    expect(panel().hidden).toBe(true);
    // Collapsed, the header still says the weights are wrong.
    expect(toggle().closest('.section-header').textContent).toMatch(/Weights must total 100% · now 110%/);

    const before = JSON.stringify(STORE.get(PROFILE));
    await click(screen.getByText('Save Changes'));

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(panel().hidden).toBe(false);
    const error = screen.getByTestId('weights-total-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toMatch(/Not saved\. Total must equal 100%\. Currently at 110%\. Reduce by 10%\./);
    await waitFor(() => expect(document.activeElement).toBe(error));

    // Nothing written, no search, values kept for correcting, not normalised.
    expect(JSON.stringify(STORE.get(PROFILE))).toBe(before);
    expect(searchCalls()).toBe(0);
    expect(numberInput('Industry Match').value).toBe('50');
    expect(numberInput('Revenue Match').value).toBe('10');
  });

  it('the message and the invalid controls are linked for screen readers, then clear once fixed', async () => {
    await mountSettings();
    await click(toggle());
    fireEvent.change(numberInput('Revenue Match'), { target: { value: '0' } }); // 90
    for (const [, label] of FACTORS) {
      expect(numberInput(label).getAttribute('aria-invalid')).toBe('true');
      expect(numberInput(label).getAttribute('aria-describedby')).toBe('weights-total-error');
    }
    // Before a save is attempted the running total isn't announced as an alert.
    expect(screen.getByTestId('weights-total-error').getAttribute('role')).toBeNull();
    expect(screen.getByTestId('weights-total-error').textContent).toMatch(/Add 10%/);

    fireEvent.change(numberInput('Revenue Match'), { target: { value: '10' } });
    expect(screen.queryByTestId('weights-total-error')).toBeNull();
    expect(numberInput('Revenue Match').hasAttribute('aria-invalid')).toBe(false);
  });

  it('after a blocked save, fixing the total and saving again goes through', async () => {
    await mountSettings();
    await click(toggle());
    fireEvent.change(numberInput('Location Match'), { target: { value: '10' } }); // 80
    await click(screen.getByText('Save Changes'));
    expect(screen.getByTestId('weights-total-error')).toBeTruthy();
    fireEvent.change(numberInput('Employee Size Match'), { target: { value: '40' } }); // 100
    await click(screen.getByText('Save Changes'));
    await waitFor(() => expect(STORE.get(PROFILE).scoringWeights)
      .toEqual({ industry: 40, location: 10, employeeSize: 40, revenue: 10 }));
  });

  it('works from the keyboard: a native button, Enter opens it, Tab reaches the controls, Space closes it', async () => {
    const user = userEvent.setup();
    await mountSettings();
    toggle().focus();
    expect(document.activeElement).toBe(toggle());
    expect(toggle().tagName).toBe('BUTTON');
    expect(toggle().getAttribute('type')).toBe('button');
    await user.keyboard('{Enter}');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    await user.tab();
    expect(within(panel()).getAllByRole('slider')).toContain(document.activeElement);
    toggle().focus();
    await user.keyboard(' ');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('a profile saved without weights gets the defaults, as before', async () => {
    seed(null);
    await mountSettings();
    await click(toggle());
    for (const [key, label] of FACTORS) expect(numberInput(label).value).toBe(String(DEFAULT_WEIGHTS[key]));
  });
});

// ── Readability in all seven themes ─────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const css = file => readFileSync(resolve(here, '..', file), 'utf8');
const INDEX = css('index.css');
const SETTINGS = css('pages/Scout/ICPSettings.css');

/** Custom properties of every block whose selector matches, later blocks winning. */
function block(source, selectorRe) {
  const re = new RegExp(selectorRe.source, 'g');
  const out = {};
  for (const m of source.matchAll(re)) {
    const body = source.slice(m.index + m[0].length, source.indexOf('}', m.index));
    for (const x of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[x[1]] = x[2].trim();
  }
  return out;
}
const rgba = v => {
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [...[0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)), 1];
  m = v.match(/rgba\(([^)]+)\)/);
  const [r, g, b, a] = m[1].split(',').map(Number);
  return [r, g, b, a];
};
const over = ([r, g, b, a], [R, G, B]) => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
const lum = c => {
  const [r, g, b] = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('the weights error is readable in every theme', () => {
  const root = block(INDEX, /(?:^|\n):root\s*\{/);
  for (const theme of ['workspace', 'mission', 'navy', 'sand', 'darkSide', 'lightSide', 'theForce']) {
    it(theme, () => {
      const tokens = {
        ...root,
        ...block(INDEX, new RegExp(`html\\[data-theme="${theme}"\\]\\s*\\{`)),
        ...block(SETTINGS, new RegExp(`html\\[data-theme="${theme}"\\] \\.advanced-scoring[^{]*\\{`)),
      };
      const card = rgba(tokens['--bg-card']).slice(0, 3);
      const bg = over(rgba(tokens['--status-error-bg']), card);
      expect(contrast(rgba(tokens['--status-error-text']).slice(0, 3), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgba(tokens['--status-error']).slice(0, 3), bg)).toBeGreaterThanOrEqual(3);
    });
  }
});
