/**
 * MyCardPage — a person's own card, at /contact-hub/my-card.
 *
 * Only joins what already exists: the card service and its revision-aware hook
 * (useMyCard), the draft (useCardDraft, inside it), the editor, the preview,
 * the layout, Save, and Download contact. It adds no rules.
 *
 * WHOSE CARD: the REAL signed-in account's (auth.currentUser), never the user
 * an admin is viewing as. While impersonating the page shows a notice and
 * nothing else: no card is read, no draft is read or kept, and nothing can be
 * saved (useMyCard, uid + impersonating).
 *
 * WHAT IS SAVED: only what the person saves, with Save, against the revision
 * the card was loaded at; a newer saved version is a conflict they settle.
 * Sharing is not touched: there is no public-card sharing control on this page, the card is
 * private, and the service writes `sharingEnabled: false` every time. The
 * Shared / Private switches only say what a shared card WILL show.
 *
 * WHAT IS DOWNLOADED: the draft as it is now, and only what the preview shows.
 * Downloading saves nothing and calls nothing.
 *
 * Contact Hub's entries in the application sidebar are drawn here too (My Card
 * is lit). The people are NOT loaded for it, so My People shows without a count;
 * the Sticker Wall is offered when stickers are available to this account.
 * A draft not yet saved is kept as the page is left and comes back on return
 * (useMyCard, unmount flush).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { auth } from '../../firebase/config';
import { useImpersonation } from '../../context/ImpersonationContext';
import { myCardService } from '../../services/myCardService';
import { CONTACT_HUB_MY_CARD_PATH, CONTACT_HUB_PATH, CONTACT_HUB_STICKERS_PATH } from '../../constants/contactHub';
import HubSidebarNav from './HubSidebarNav';
import { useStickersAvailabilityControl } from '../../components/stickers/useStickersAvailability';
import { AVAILABILITY } from '../../components/stickers/stickersAvailabilityState';
import { HUB_STATUS } from './peopleRules';
import MyCardLayout from './myCard/MyCardLayout';
import MyCardEditor from './myCard/MyCardEditor';
import MyCardPreview from './myCard/MyCardPreview';
import MyCardSaveBar from './myCard/MyCardSaveBar';
import MyCardDownload from './myCard/MyCardDownload';
import { MyCardBlocked, MyCardNotices } from './myCard/MyCardNotices';
import { contactDownloadState, downloadContact } from './myCard/downloadContact';
import { imageDownloadState } from './myCard/cardImageDownload';
import { useCardImageDownload } from './myCard/useCardImageDownload';
import { useMyCard } from './myCard/state/useMyCard';
import { describeChanges } from './myCard/state/myCardDiff';

const NO_PEOPLE = Object.freeze([]);

/** The uid signed in right now, from the one place that knows. */
const currentUid = () => auth.currentUser?.uid ?? null;

/** The signed-in account, following sign-in and sign-out while the page is open. */
function useSignedInUid() {
  const [uid, setUid] = useState(currentUid);
  useEffect(() => auth.onAuthStateChanged((user) => setUid(user?.uid ?? null)), []);
  return uid;
}

export default function MyCardPage() {
  const { isImpersonating } = useImpersonation();
  const uid = useSignedInUid();
  return <MyCardPageAccount key={`${uid ?? 'signed-out'}:${isImpersonating ? 'readonly' : 'owner'}`} uid={uid} isImpersonating={isImpersonating} />;
}

function MyCardPageAccount({ uid, isImpersonating }) {
  const { draft, state, status, availability, choices, actions } = useMyCard({
    uid, impersonating: isImpersonating, service: myCardService, currentUid,
  });

  // Where Save leaves a card that is not valid, the first thing to fix is focused.
  const [focusTick, setFocusTick] = useState(0);
  const [editingCard, setEditingCard] = useState(false);
  useEffect(() => {
    if (focusTick > 0) document.querySelector('.mycard [aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const { save } = actions;
  const settleSavedView = useCallback((result) => {
    if (result.status === 'invalid') setFocusTick((tick) => tick + 1);
    if (result.status === 'saved' && !result.hasUnsavedChanges) setEditingCard(false);
    return result;
  }, []);
  const handleSave = useCallback(async () => {
    return settleSavedView(await save());
  }, [save, settleSavedView]);
  const handleConfirmSaveOver = useCallback(async () => settleSavedView(await actions.confirmSaveOver()), [actions, settleSavedView]);

  const handleCancelEdit = useCallback(() => {
    if (status === 'saving') return;
    if ((draft.dirty || state.recovered) && !window.confirm('Discard these card edits and return to your finished card?')) return;
    if (state.recovered) actions.discardRecovered();
    else draft.discard();
    setEditingCard(false);
  }, [actions, draft, state.recovered, status]);

  // The answer to a download is shown only while the card is as it was when it was clicked.
  const [downloaded, setDownloaded] = useState(null);
  const handleDownload = () => setDownloaded({ forCard: draft.card, result: downloadContact(draft.card) });
  const feedback = downloaded && downloaded.forCard === draft.card ? downloaded.result : null;

  // The card image is made from the same draft, by the card's own renderer: only what is Shared, and never saved.
  const cardImage = useCardImageDownload(draft.card);

  const navigate = useNavigate();
  // The Sticker Wall is offered here too, on the server's answer alone: this page is outside ContactHubMain's
  // sticker provider, and needs neither the people nor the sticker registry for it.
  const { state: stickersAvailability } = useStickersAvailabilityControl();
  const sidebar = (
    <HubSidebarNav
      status={HUB_STATUS.LOADING}
      people={NO_PEOPLE}
      section="card"
      selectedId={null}
      onSelect={() => navigate(CONTACT_HUB_PATH)}
      onOpenWall={() => navigate(CONTACT_HUB_STICKERS_PATH)}
      onOpenCard={() => navigate(CONTACT_HUB_MY_CARD_PATH)}
      wallAvailable={stickersAvailability === AVAILABILITY.AVAILABLE}
    />
  );

  const back = (
    <Link className="mycard-back" to={CONTACT_HUB_PATH}>
      <ArrowLeft size={16} aria-hidden="true" />
      <span>My People</span>
    </Link>
  );

  // No card to show: loading, could not load, impersonating, signed out.
  if (state.load !== 'ready') {
    return <>{sidebar}<MyCardLayout back={back} editor={<MyCardBlocked state={state} onRetryLoad={actions.retryLoad} />} /></>;
  }

  const download = contactDownloadState(draft.card);
  const changeLabels = state.conflict ? describeChanges(state.conflict.changes) : [];

  return (
    <>
    {sidebar}
    <MyCardLayout
      editing={editingCard}
      onEdit={() => setEditingCard(true)}
      onCancelEdit={handleCancelEdit}
      back={back}
      notice={(
        <MyCardNotices
          state={state}
          choices={choices}
          changeLabels={changeLabels}
          onRetrySave={handleSave}
          onDismissRecovered={actions.dismissRecovered}
          onDiscardRecovered={actions.discardRecovered}
          onChooseConflict={actions.chooseConflict}
          onCancelConflict={actions.cancelConflict}
          onConfirmLoadLatest={actions.confirmLoadLatest}
          onConfirmSaveOver={handleConfirmSaveOver}
        />
      )}
      editor={(
        <MyCardEditor
          card={draft.card}
          errors={draft.errors}
          suggestions={state.suggestions}
          onEdit={draft.edit}
          onBlur={draft.blur}
          onShare={draft.setShare}
          onUseSuggestion={draft.useSuggestion}
          onSubmit={availability.enabled ? handleSave : undefined}
        />
      )}
      preview={(
        <>
          <MyCardPreview card={draft.card} />
          <MyCardDownload
            available={download.available}
            onDownload={handleDownload}
            feedback={feedback}
            image={{
              available: imageDownloadState(draft.card).available,
              busy: cardImage.busy,
              onDownload: cardImage.download,
              feedback: cardImage.feedback,
              pictureUrl: cardImage.pictureUrl,
              onClosePicture: cardImage.closePicture,
            }}
          />
        </>
      )}
      actions={(
        <MyCardSaveBar
          status={status}
          availability={availability}
          errorCount={Object.keys(draft.errors).length}
          onSave={handleSave}
          onCancel={handleCancelEdit}
        />
      )}
    />
    </>
  );
}
