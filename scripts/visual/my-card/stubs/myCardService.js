/**
 * A stand-in for src/services/myCardService.js: the card service, answering
 * from sample data according to ?state=. Nothing is read from or written to
 * any database. (vite.config.mjs aliases the real module to this.)
 *
 *   existing      a saved card                      saveerror     saves fail (offline)
 *   new           no card yet, suggestions on offer saveconflict  the first save finds a newer card
 *   loaderror     the card cannot be loaded         restored      a draft from before is waiting
 *   olddraft      a draft from an older revision is waiting (a conflict on opening)
 */
import { newCard, normalizeCard } from '../../../../src/utils/myCardRules';
import { saveDraft, clearAllMyCardDrafts } from '../../../../src/pages/ContactHub/myCard/state/myCardDraftStorage';

const params = new URLSearchParams(window.location.search);
const state = params.get('state') ?? 'existing';
const UID = 'fixture-user';
const PHOTO = 'https://images.fixture.test/ada.svg';

const saved = (extra = {}) => ({
  ...newCard(),
  firstName: 'Ada', lastName: 'Lovelace', photoUrl: PHOTO, title: 'Founder & CEO', organization: 'Analytical Engines',
  email: 'ada@analyticalengines.example', phone: '+1 (555) 010-2000', linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace',
  instagram: 'ada.lovelace', website: 'https://analyticalengines.example/',
  ...extra,
});

// A draft left from before, as the page would have kept it.
clearAllMyCardDrafts();
if (state === 'restored') {
  saveDraft({ uid: UID, card: saved({ title: 'Chief Mathematician', phone: '+1 (555) 010-3000' }), baseRevision: 3 }, { now: Date.now() - 5 * 60 * 1000 });
}
if (state === 'olddraft') {
  saveDraft({ uid: UID, card: saved({ title: 'Chief Mathematician', share: { ...newCard().share, email: true } }), baseRevision: 2 }, { now: Date.now() - 5 * 60 * 1000 });
}

const OFFLINE = { status: 'error', code: 'unavailable', message: 'Couldn\'t reach IDYNIFY. Check your connection and try again.', retryable: true };
let saves = 0;

export const myCardService = {
  async loadMyCard() {
    if (state === 'loaderror') return OFFLINE;
    if (state === 'new') return { status: 'missing', card: newCard(), revision: null };
    if (state === 'olddraft') return { status: 'ok', card: saved({ title: 'Founder' }), revision: 5 };
    return { status: 'ok', card: saved(), revision: 3 };
  },
  async loadCardSuggestions() {
    if (state === 'new') {
      return {
        suggestions: {
          firstName: { value: 'Ada', source: 'settings' }, lastName: { value: 'Lovelace', source: 'settings' },
          email: { value: 'ada@analyticalengines.example', source: 'account' }, photoUrl: { value: PHOTO, source: 'linkedin' },
          title: { value: 'Founder & CEO', source: 'recon' }, organization: { value: 'Analytical Engines', source: 'recon' },
        },
        unavailable: [],
      };
    }
    return { suggestions: {}, unavailable: [] };
  },
  async saveMyCard(card, { expectedRevision }) {
    saves += 1;
    if (state === 'saveerror') return OFFLINE;
    if (state === 'saveconflict' && saves === 1) {
      return { status: 'conflict', current: { status: 'ok', card: saved({ title: 'Founder', phone: '+1 (555) 010-9999' }), revision: 5 } };
    }
    return { status: 'saved', card: { ...normalizeCard(card).card, sharingEnabled: false }, revision: (expectedRevision ?? 0) + 1 };
  },
};
