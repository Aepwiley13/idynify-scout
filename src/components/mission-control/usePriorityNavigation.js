/**
 * usePriorityNavigation — one way for Mission Control to open a priority.
 *
 * Both surfaces that render priorities (the Today's Priorities grid and the
 * right rail) used to do the same thing: `navigate(item.route)`. That is a URL
 * and nothing else, so everything the card knew — that this contact surfaced
 * because a next step is overdue, that the recommended action is to complete
 * it, that Back belongs to Mission Control — was discarded at the moment of
 * the click, and the destination had to guess.
 *
 * Now both call this. Contacts go through openContact() with full intent;
 * missions and campaigns keep their plain route, because Hunter's mission page
 * is not a canonical record destination and this sprint does not touch it.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { openContact, DISPLAY_MODES, ENTRY_POINTS } from '../../utils/navigation';
import { MISSION_CONTROL } from '../../constants/navigationModel';

export default function usePriorityNavigation() {
  const navigate = useNavigate();

  return useCallback((item) => {
    if (!item) return;

    if (item.entityType === 'contact' && item.entityId) {
      openContact({
        navigate,
        contactId: item.entityId,
        entryPoint: ENTRY_POINTS.MISSION_CONTROL,
        reason: item.reasonCode ?? item.type ?? null,
        recommendedAction: item.recommendedAction ?? null,
        priorityId: item.priorityId ?? item.id ?? null,
        taskId: item.taskId ?? null,
        // Pinned to the dashboard rather than to location.pathname. Mission
        // Control is where the user was, and it is where the resolved priority
        // disappears from — returning anywhere else would show them a stale
        // list they cannot act on.
        returnTo: MISSION_CONTROL.path,
        displayMode: DISPLAY_MODES.PAGE,
      });
      return;
    }

    if (item.route) navigate(item.route);
  }, [navigate]);
}
