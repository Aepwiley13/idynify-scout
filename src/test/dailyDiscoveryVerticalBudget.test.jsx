/**
 * THE CHROME AROUND THE DAILY DISCOVERY CARD STAYS SMALL.
 *
 * Making the card's height content-driven (PR #657) left it overhanging the
 * fold: 191px at 1280x720, so both decision buttons and "Skip for now" sat
 * below it on a common laptop size. The card is not the thing to shrink — its
 * content, padding and type scale are fixed — so the space came out of the
 * chrome around it:
 *
 *   - the two progress dot rows, 27px each, replaced by the count they
 *     annotated moving onto the header's control cluster;
 *   - the header's padding, and the title/subtitle stacking above 1024px;
 *   - the card column's padding and the footer hint's top margin.
 *
 * What may NOT come out is the 44px minimum touch target on the ICP chip row
 * and the Companies/People tabs. Their visual height is smaller than that —
 * the floor is a tap target, not a look — so it is the first thing a future
 * "make it fit" change will be tempted to take. These tests hold that line, and
 * hold the dot rows down.
 *
 * jsdom lays nothing out, so the budget itself is measured in Chromium. At
 * 1280x720 the header block went 179px -> 148px and the overhang 191px -> 117px;
 * at 390x844 a median card now fits with 63px to spare.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../pages/Scout/DailyLeads.jsx'), 'utf8');

describe('Daily Discoveries chrome — tap targets survive the squeeze', () => {
  it('the ICP chip row keeps a 44px minimum', () => {
    const chip = src.slice(src.indexOf('onDoubleClick={() => navigate(`/scout?tab=icp-settings'));
    expect(chip.slice(0, 600), 'an ICP chip no longer guarantees a 44px touch target')
      .toMatch(/minHeight: 44/);
  });

  it('the Companies/People tabs keep a 44px minimum', () => {
    const tabs = src.slice(src.indexOf("[['companies', 'Companies'], ['people', 'People']]"));
    expect(tabs.slice(0, 700), 'a tab no longer guarantees a 44px touch target')
      .toMatch(/minHeight: 44/);
  });
});

describe('Daily Discoveries chrome — the reclaimed space stays reclaimed', () => {
  it('neither tab renders a progress dot row', () => {
    // 10 dots and a count, 27px of band, directly above a card that overhangs.
    expect(src, 'the batch dot row is back').not.toMatch(/renderBatchDots/);
    expect(src, 'the queue dot row is back').not.toMatch(/renderDots/);
  });

  it('the count those rows carried is still rendered', () => {
    expect(src, 'progress count lost with the dots').toMatch(/const progressLabel = tab === 'people'/);
    expect(src, 'progress count is computed but never shown').toMatch(/\{progressLabel && \(/);
  });

  it('the header band and the card column stay tight', () => {
    // Half the previous padding above the title, and a third off the column.
    expect(src, 'header padding grew back').toMatch(/padding: isDesktop \? '12px 32px 0' : '10px 26px 0'/);
    expect(src, 'card column padding grew back')
      .toMatch(/padding: isDesktop \? '10px 16px 6px' : '10px 12px 6px'/);
  });

  it('the card itself is not what got smaller', () => {
    // The stage floors from #657 are measured medians of the card's own
    // height. If a change to the card had shrunk it, these would have moved.
    expect(src).toMatch(/const COMPANY_STAGE_MIN_H = isDesktop \? 584 : 522;/);
    expect(src).toMatch(/const PERSON_STAGE_MIN_H = isDesktop \? 512 : 456;/);
  });
});
