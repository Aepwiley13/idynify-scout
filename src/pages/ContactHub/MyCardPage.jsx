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
 * Sharing is not touched: there is no control for it on this page, the card is
 * private, and the service writes `sharingEnabled: false` every time. The
 * Shared / Private switches only say what a shared card WILL show.
 *
 * WHAT IS DOWNLOADED: the draft as it is now, and only what the preview shows.
 * Downloading saves nothing and calls nothing.
 *
 * Reachable by address only until navigation links it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { auth } from '../../firebase/config';
import { useImpersonation } from '../../context/ImpersonationContext';
import { myCardService } from '../../services/myCardService';
import { CONTACT_HUB_PATH } from '../../constants/contactHub';
import MyCardLayout from './myCard/MyCardLayout';
import MyCardEditor from './myCard/MyCardEditor';
import MyCardPreview from './myCard/MyCardPreview';
import MyCardSaveBar from './myCard/MyCardSaveBar';
import MyCardDownload from './myCard/MyCardDownload';
import { MyCardBlocked, MyCardNotices } from './myCard/MyCardNotices';
import { contactDownloadState, downloadContact } from './myCard/downloadContact';
import { useMyCard } from './myCard/state/useMyCard';
import { describeChanges } from './myCard/state/myCardDiff';

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
  const { draft, state, status, availability, choices, actions } = useMyCard({
    uid, impersonating: isImpersonating, service: myCardService, currentUid,
  });

  // Where Save leaves a card that is not valid, the first thing to fix is focused.
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) document.querySelector('.mycard [aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const { save } = actions;
  const handleSave = useCallback(async () => {
    const result = await save();
    if (result.status === 'invalid') setFocusTick((tick) => tick + 1);
  }, [save]);

  // The answer to a download is shown only while the card is as it was when it was clicked.
  const [downloaded, setDownloaded] = useState(null);
  const handleDownload = () => setDownloaded({ forCard: draft.card, result: downloadContact(draft.card) });
  const feedback = downloaded && downloaded.forCard === draft.card ? downloaded.result : null;

  const back = (
    <Link className="mycard-back" to={CONTACT_HUB_PATH}>
      <ArrowLeft size={16} aria-hidden="true" />
      <span>My People</span>
    </Link>
  );

  // No card to show: loading, could not load, impersonating, signed out.
  if (state.load !== 'ready') {
    return <MyCardLayout back={back} editor={<MyCardBlocked state={state} onRetryLoad={actions.retryLoad} />} />;
  }

  const download = contactDownloadState(draft.card);
  const changeLabels = state.conflict ? describeChanges(state.conflict.changes) : [];

  return (
    <MyCardLayout
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
          onConfirmSaveOver={actions.confirmSaveOver}
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
          <MyCardDownload available={download.available} onDownload={handleDownload} feedback={feedback} />
        </>
      )}
      actions={(
        <MyCardSaveBar
          status={status}
          availability={availability}
          errorCount={Object.keys(draft.errors).length}
          onSave={handleSave}
        />
      )}
    />
  );
}
