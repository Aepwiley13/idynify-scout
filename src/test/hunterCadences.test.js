/**
 * #003.5 — Hunter is the canonical home for Cadences.
 *
 * Cadences are bulk outreach; they now open at /hunter?tab=cadences. Scout no
 * longer lists a duplicate entry (old ?tab=cadences links redirect). The
 * /scout/cadences and /scout/cadence/:id routes are kept, and the shell
 * highlights Hunter on them. Sending, scheduling, permissions and suppression
 * code are not part of this change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveModule } from '../constants/navigationModel';
import { MODULE_BOTTOM_NAV } from '../constants/mobileNavigation';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const all = (s) => [...(s.primary || []), ...(s.overflow || [])];

describe('the shell highlights Hunter on cadence pages', () => {
  it.each(['/scout/cadences', '/scout/cadence/abc123'])('%s → Hunter', (path) => {
    expect(resolveModule(path).id).toBe('hunter');
  });
  it.each(['/scout', '/scout/total-market', '/scout/company/c1/leads', '/scout/game'])('%s stays Scout', (path) => {
    expect(resolveModule(path).id).toBe('scout');
  });
});

describe('entry points', () => {
  it('desktop: Hunter has a Cadences tab hosting the existing list', () => {
    const h = src('pages/Hunter/HunterMain.jsx');
    expect(h).toMatch(/id: 'cadences',\s+label: 'Cadences'/);
    expect(h).toMatch(/cadences:\s+'cadences'/);
    expect(h).toMatch(/import CadencesList from '\.\.\/Scout\/CadencesList'/);
    expect(h).toMatch(/activeTab === 'cadences'[\s\S]{0,400}<CadencesList \/>/);
  });

  it('desktop: Command Center links to Hunter; Scout drops its entry and redirects old links', () => {
    expect(src('pages/Scout/PeopleMain.jsx')).toMatch(/id: 'cadences'.*route: '\/hunter\?tab=cadences'/);
    const scout = src('pages/Scout/ScoutMain.jsx');
    expect(scout).not.toMatch(/\{ id: 'cadences',/);
    expect(scout).toMatch(/activeView === 'cadences'\)\s+return <Navigate to="\/hunter\?tab=cadences" replace \/>/);
  });

  it('mobile: Hunter and Command Center open Hunter Cadences; Scout has no Cadences entry', () => {
    expect(all(MODULE_BOTTOM_NAV.hunter).find(i => i.id === 'cadences')?.to).toBe('/hunter?tab=cadences');
    expect(all(MODULE_BOTTOM_NAV['command-center']).find(i => i.id === 'cadences')?.to).toBe('/hunter?tab=cadences');
    expect(all(MODULE_BOTTOM_NAV.scout).find(i => i.id === 'cadences')).toBeUndefined();
  });

  it('cadence detail returns to the Hunter list', () => {
    const d = src('pages/Scout/CadenceDetail.jsx');
    expect(d).not.toMatch(/navigate\('\/scout\/cadences'\)/);
    expect(d.match(/navigate\('\/hunter\?tab=cadences'\)/g)).toHaveLength(2);
  });
});

describe('routes and contextual shortcuts are preserved', () => {
  it('keeps /scout/cadences and /scout/cadence/:cadenceId', () => {
    const app = src('App.jsx');
    expect(app).toMatch(/path="\/scout\/cadences" element=\{<CadencesList \/>\}/);
    expect(app).toMatch(/path="\/scout\/cadence\/:cadenceId" element=\{<CadenceDetail \/>\}/);
  });

  it('the list still opens each cadence at its existing detail route', () => {
    const list = src('pages/Scout/CadencesList.jsx');
    expect(list.match(/navigate\(`\/scout\/cadence\/\$\{/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
