/**
 * HubSidebarNav — Contact Hub's own entries, drawn under "Contact Hub" in the
 * application sidebar.
 *
 * My People with how many there are, the Sticker Wall, one entry per active
 * sticker with how many of the listed people have it, and New sticker.
 *
 * The sidebar offers an empty place for this only while Contact Hub is the
 * active module and the sidebar is wide (components/layout/sidebarSlots.js).
 * This component lives inside Contact Hub and draws into that place, so it
 * uses what the page already has: the people ContactHubMain loaded and the
 * page's one sticker registry (StickersProvider). It reads nothing itself and
 * adds no listener. When the sidebar offers no place (compact sidebar, a
 * phone, a page rendered without the shell) it draws nothing, and the page's
 * own sticker navigation is what there is.
 *
 * WHAT IT SHOWS IN EACH STATE
 * My People is always here, so Contact Hub always has its entry; its count
 * appears once the people have loaded. The sticker entries are added when
 * there is something for them to act on:
 *   people still loading, or failed to load                 My People
 *   nobody in My People yet                                 My People (0)
 *   stickers not available for this account                 My People
 *   stickers still checking or loading                      My People
 *   the sticker list failed to load                         My People, and a message
 *   ready, with people                                      all of it
 * New sticker is offered exactly when the page's own sticker controls are:
 * when stickers are available to this user and their list has loaded.
 */
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, Plus, Users } from 'lucide-react';
import { useSidebarSlot } from '../../components/layout/sidebarSlots';
import { CONTACT_HUB_SIDEBAR_SLOT } from '../../constants/contactHub';
import { useStickers } from '../../components/stickers/stickersRegistry';
import { AVAILABILITY } from '../../components/stickers/stickersAvailabilityState';
import { countStickers } from '../../components/stickers/peopleStickers';
import { hexOf } from '../../components/stickers/stickerPalette';
import { createSticker } from '../../services/stickerService';
import StickerDialog from '../../components/stickers/StickerDialog';
import { HUB_STATUS, stickersFailedToLoad } from './peopleRules';
import StickersLoadError from './StickersLoadError';

/**
 * @param status      ContactHubMain's load of the people (HUB_STATUS)
 * @param people      everyone listed in My People
 * @param section     'people' | 'wall' | 'person': where in Contact Hub this is
 * @param selectedId  the sticker My People is filtered by, or null
 * @param onSelect    (stickerId | null) => go to My People with that filter
 * @param onOpenWall  () => go to the Sticker Wall
 */
export default function HubSidebarNav({ status, people, section, selectedId, onSelect, onOpenWall }) {
  const slot = useSidebarSlot(CONTACT_HUB_SIDEBAR_SLOT);
  const stickers = useStickers();
  const { ready, active, uid, notify } = stickers;
  const counts = useMemo(() => (ready ? countStickers(people, active) : new Map()), [ready, people, active]);
  const [creating, setCreating] = useState(false);
  const newButton = useRef(null);

  // My People is drawn whenever the sidebar offers the place, whatever the
  // people or the stickers are doing.
  if (!slot) return null;

  const loaded = status === HUB_STATUS.READY;
  // Sticker entries need people to act on (with nobody yet the page is one
  // invitation) and stickers that are on for this account.
  const withPeople = loaded && people.length > 0 && stickers.availability !== AVAILABILITY.UNAVAILABLE;
  const stickersReady = withPeople && ready;
  // The wall exists only then; without it that address is My People.
  const onWall = section === 'wall' && stickersReady;
  const onPeople = (section === 'people' || (section === 'wall' && !stickersReady)) && !(stickersReady && selectedId);
  const closeDialog = () => { setCreating(false); newButton.current?.focus(); };
  const peopleLabel = `${people.length} ${people.length === 1 ? 'person' : 'people'}`;

  return (
    <>
      {createPortal(
        <nav className="hub-sidenav" aria-label="Contact Hub sections">
          <button
            type="button"
            className="hub-sidenav-item"
            // Open on a person, this is still the section they are in.
            aria-current={onPeople ? 'page' : (section === 'person' ? 'true' : undefined)}
            onClick={() => onSelect(null)}
          >
            <Users size={15} aria-hidden="true" />
            <span className="hub-sidenav-name">My People</span>
            {loaded ? <span className="hub-sidenav-count" aria-label={peopleLabel}>{people.length}</span> : null}
          </button>

          {stickersReady && (
            <button
              type="button"
              className="hub-sidenav-item"
              aria-current={onWall ? 'page' : undefined}
              onClick={onOpenWall}
            >
              <LayoutGrid size={15} aria-hidden="true" />
              <span className="hub-sidenav-name">Sticker Wall</span>
            </button>
          )}

          {withPeople && stickersFailedToLoad(stickers) && <StickersLoadError className="hub-stickers-error--sidenav" />}

          {stickersReady && active.length > 0 && (
            <ul className="hub-sidenav-list" aria-label="Filter by sticker">
              {active.map((sticker) => {
                const on = section === 'people' && selectedId === sticker.id;
                const count = counts.get(sticker.id) ?? 0;
                return (
                  <li key={sticker.id}>
                    <button
                      type="button"
                      className="hub-sidenav-item"
                      aria-pressed={on ? 'true' : 'false'}
                      aria-label={`${sticker.name}, ${count} ${count === 1 ? 'person' : 'people'}`}
                      onClick={() => onSelect(on ? null : sticker.id)}
                    >
                      <span className="hub-sidenav-dot" style={{ background: hexOf(sticker.color) }} aria-hidden="true" />
                      {sticker.emoji ? <span aria-hidden="true">{sticker.emoji}</span> : null}
                      <span className="hub-sidenav-name">{sticker.name}</span>
                      <span className="hub-sidenav-count" aria-hidden="true">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {stickersReady && (
            <button
              ref={newButton}
              type="button"
              className="hub-sidenav-item hub-sidenav-item--new"
              onClick={() => setCreating(true)}
            >
              <Plus size={15} aria-hidden="true" />
              <span className="hub-sidenav-name">New sticker</span>
            </button>
          )}
        </nav>,
        slot,
      )}

      {/* In the page, not in the sidebar: a dialog belongs above everything. */}
      {creating ? (
        <StickerDialog
          others={active}
          onClose={closeDialog}
          // A failure is thrown back to the dialog, which shows it and stays open.
          onSubmit={async (values) => {
            await createSticker(uid, values);
            closeDialog();
            notify({ message: `Created ${values.name}` });
          }}
        />
      ) : null}
    </>
  );
}
