/**
 * My Card, for looking at. Sample data in the real components.
 *
 *   ?theme=workspace|mission      light or dark (the app's own themes)
 *   ?scenario=new|empty|full|shared|errors|long|cjk|brokenphoto|photooffer|nophoto
 *   ?view=preview                 start a narrow screen on the preview
 *
 * Nothing here reads or writes anything. The bar at the bottom is a stand-in
 * for the Save bar the page adds in the next step; its button does nothing.
 */
import '../../../src/index.css';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import MyCardEditor from '../../../src/pages/ContactHub/myCard/MyCardEditor';
import MyCardPreview from '../../../src/pages/ContactHub/myCard/MyCardPreview';
import MyCardLayout from '../../../src/pages/ContactHub/myCard/MyCardLayout';
import { useCardDraft } from '../../../src/pages/ContactHub/myCard/useCardDraft';
import { newCard } from '../../../src/utils/myCardRules';
import { buildCardSuggestions, prefilledNewCard } from '../../../src/utils/myCardSuggestions';

const params = new URLSearchParams(window.location.search);
const theme = params.get('theme') === 'mission' ? 'mission' : 'workspace';
document.documentElement.dataset.theme = theme;

// The page serves this picture for the address below (capture.mjs), so no real image host is contacted.
const PHOTO = 'https://images.fixture.test/ada.svg';

const suggestions = buildCardSuggestions({
  account: { displayName: 'Ada Lovelace', email: 'ada@analyticalengines.example' },
  linkedin: {
    status: 'connected', givenName: 'Ada', familyName: 'Lovelace', email: 'ada@linkedin.example', emailVerified: true, pictureUrl: PHOTO,
  },
  recon: { role: 'Founder & CEO', companyName: 'Analytical Engines' },
});

const filled = {
  ...newCard(),
  firstName: 'Ada', lastName: 'Lovelace', photoUrl: PHOTO, title: 'Founder & CEO', organization: 'Analytical Engines',
  email: 'ada@analyticalengines.example', phone: '+1 (555) 010-2000',
  linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace', instagram: 'ada.lovelace', website: 'https://analyticalengines.example/',
};

const ALL_SHARED = { photoUrl: true, title: true, organization: true, email: true, phone: true, linkedinUrl: true, instagram: true, website: true };

const SCENARIOS = {
  // A new card, filled in memory from what the account knows. Nothing saved.
  new: { initial: prefilledNewCard(suggestions), suggestions },
  // A blank card; what the account knows is offered, not filled.
  empty: { initial: newCard(), suggestions },
  // A saved card with the default switches: email, phone, Instagram and website private.
  full: { initial: filled, suggestions },
  shared: { initial: { ...filled, share: ALL_SHARED }, suggestions },
  errors: { initial: filled, suggestions, errorsOn: true },
  long: {
    initial: {
      ...filled, share: ALL_SHARED,
      firstName: 'Bartholomew-Alexandrovich', lastName: 'Featherstonehaugh-Cholmondeley',
      title: 'Senior Vice President of Global Strategic Partnerships and Ecosystem Development',
      organization: 'The International Association of Analytical Engine Manufacturers and Allied Trades',
      email: 'bartholomew.featherstonehaugh-cholmondeley@internationalassociation-analyticalengines.example',
      website: 'https://www.internationalassociation-analyticalengines.example/members/leadership/bartholomew',
    },
    suggestions: null,
  },
  cjk: { initial: { ...filled, share: ALL_SHARED, firstName: 'José', lastName: '李小龍', title: '創辦人兼執行長', organization: 'Café Ünïcode 株式会社' }, suggestions: null },
  brokenphoto: { initial: { ...filled, photoUrl: 'https://images.invalid/gone.jpg' }, suggestions },
  // A saved card with no photo, and the LinkedIn photo on offer: the friendly start.
  photooffer: { initial: { ...filled, photoUrl: '' }, suggestions },
  // No photo and nothing on offer: the link field is simply there.
  nophoto: { initial: { ...filled, photoUrl: '' }, suggestions: null },
};
const scenario = SCENARIOS[params.get('scenario')] ?? SCENARIOS.new;

export default function Workbench() {
  const draft = useCardDraft(scenario.initial);

  useEffect(() => {
    if (!scenario.errorsOn) return;
    // What a person sees after typing wrong values and trying to save.
    draft.edit('email', 'ada@');
    draft.edit('phone', 'call me');
    draft.edit('website', 'not a web address');
    draft.edit('linkedinUrl', 'https://example.com/ada');
    draft.showAllErrors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MyCardLayout
      initialView={params.get('view') === 'preview' ? 'preview' : 'edit'}
      editor={(
        <MyCardEditor
          card={draft.card}
          errors={draft.errors}
          suggestions={scenario.suggestions}
          onEdit={draft.edit}
          onBlur={draft.blur}
          onShare={draft.setShare}
          onUseSuggestion={draft.useSuggestion}
        />
      )}
      preview={<MyCardPreview card={draft.card} />}
      actions={(
        <>
          <span style={{ marginRight: 'auto', fontSize: 13, color: 'var(--text-secondary)' }}>
            Placeholder for the Save bar added in the next step.
          </span>
          <button
            type="button"
            disabled
            style={{ minHeight: 48, padding: '0 22px', border: 'none', borderRadius: 14, background: 'var(--accent)', color: '#fff', font: 'inherit', fontSize: 17, fontWeight: 700, opacity: 0.55 }}
          >
            Save
          </button>
        </>
      )}
    />
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="fx-content"><Workbench /></div>
  </StrictMode>,
);
