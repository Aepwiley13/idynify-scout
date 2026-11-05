/**
 * StickersProvider — one sticker registry per page (ADR-007, UI spec §0).
 *
 * Asks the server once whether stickers are available here
 * (useStickersAvailabilityControl) and, only when they are, subscribes once
 * to the user's sticker registry. Every sticker surface on the page reads it
 * through useStickers(), so a page with a profile row, a filter and a grid
 * still holds one availability answer and one registry listener.
 *
 * A provider inside another one (People's side panel renders a Contact
 * Profile) reuses the outer one and subscribes to nothing.
 *
 * useStickers() (stickersRegistry.js) reads it. Outside any provider it
 * answers 'unavailable': a surface mounted without one shows nothing.
 */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { subscribeStickers } from '../../services/stickerService';
import { STICKER_STATUS, sortStickers } from '../../services/stickers/stickerCore';
import { AVAILABILITY } from './stickersAvailabilityState.js';
import { useStickersAvailabilityControl } from './useStickersAvailability.js';
import { REGISTRY_STATUS, StickersContext } from './stickersRegistry.js';
import StickerToast from './StickerToast';

function StickersRoot({ uid, children }) {
  const { state: availability, recheck } = useStickersAvailabilityControl();
  const listening = availability === AVAILABILITY.AVAILABLE && typeof uid === 'string' && uid.length > 0;
  // The registry belongs to the uid it was loaded for; anything else is still loading.
  const [registry, setRegistry] = useState({ uid: null, status: REGISTRY_STATUS.IDLE, all: [] });
  // The page's one sticker notice. It lives here, not in a surface, so a
  // message outlives the surface that raised it: "Stickers can't be changed
  // right now" stays on screen while the row it came from disappears.
  const [notice, setNotice] = useState(null);
  const notify = useCallback((next) => setNotice({ ...next, id: Date.now() + Math.random() }), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (!listening) return undefined;
    let live = true;
    const fail = (err) => {
      // Codes only: no sticker or contact data in logs (UI spec U7).
      console.warn('[stickers] registry unavailable', { code: err?.code ?? 'unknown' });
      if (live) setRegistry({ uid, status: REGISTRY_STATUS.ERROR, all: [] });
    };
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeStickers(uid, (all) => { if (live) setRegistry({ uid, status: REGISTRY_STATUS.READY, all }); }, fail);
    } catch (err) {
      Promise.resolve().then(() => fail(err));
    }
    return () => {
      live = false;
      unsubscribe();
    };
  }, [listening, uid]);

  const value = useMemo(() => {
    const current = listening && registry.uid === uid
      ? registry
      : { status: listening ? REGISTRY_STATUS.LOADING : REGISTRY_STATUS.IDLE, all: [] };
    const all = current.all;
    const active = sortStickers(all.filter((s) => s.status === STICKER_STATUS.ACTIVE));
    const archived = sortStickers(all.filter((s) => s.status === STICKER_STATUS.ARCHIVED));
    return {
      provided: true,
      availability,
      recheck,
      uid: listening ? uid : null,
      status: current.status,
      all,
      active,
      archived,
      byId: new Map(all.map((s) => [s.id, s])),
      notify,
    };
  }, [availability, recheck, listening, uid, registry, notify]);

  return (
    <StickersContext.Provider value={value}>
      {children}
      <StickerToast toast={notice} onDismiss={dismissNotice} />
    </StickersContext.Provider>
  );
}

export function StickersProvider({ uid, children }) {
  const outer = useContext(StickersContext);
  if (outer.provided) return children;
  return <StickersRoot uid={uid}>{children}</StickersRoot>;
}

export default StickersProvider;
