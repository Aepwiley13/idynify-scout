/**
 * The state of "Download card image" for the page: one picture at a time, the
 * answer to the last click, and the picture on the page when the browser would
 * not start the download.
 *
 *   busy       a picture is being made (or the share sheet is open): the button is off,
 *              so a second tap cannot make a second picture
 *   feedback   the answer to the last click, only while the card is as it was then
 *   pictureUrl an address for the fallback picture, let go when it is replaced, closed or the page is left
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadCardImage } from './cardImageDownload';

export function useCardImageDownload(card, { run = downloadCardImage } = {}) {
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const urlRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null); // { forCard, result, pictureUrl }

  const letGo = useCallback(() => {
    if (urlRef.current) { window.URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; letGo(); };
  }, [letGo]);

  const download = useCallback(async () => {
    // A ref, not only state: two taps in the same moment must not both get through.
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setOutcome(null);
    letGo();
    let result;
    try {
      result = await run(card);
    } catch {
      result = { status: 'failed', message: 'We couldn\'t make the card image. Try again.' };
    }
    busyRef.current = false;
    if (!mounted.current) return;
    let pictureUrl = null;
    if (result.status === 'fallback' && result.blob) {
      pictureUrl = window.URL.createObjectURL(result.blob);
      urlRef.current = pictureUrl;
    }
    setBusy(false);
    setOutcome({ forCard: card, result, pictureUrl });
  }, [card, run, letGo]);

  const closePicture = useCallback(() => { letGo(); setOutcome(null); }, [letGo]);

  const current = outcome && outcome.forCard === card ? outcome : null;
  return {
    busy,
    download,
    closePicture,
    feedback: current ? current.result : null,
    pictureUrl: current ? current.pictureUrl : null,
  };
}

export default useCardImageDownload;
