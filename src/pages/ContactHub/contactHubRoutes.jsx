/**
 * Contact Hub's routes, and the one decision about whether they exist.
 *
 * App.jsx calls contactHubRoutes() inside its shell route group. With the
 * switch off (the default, constants/contactHub.js) it returns null: no
 * Contact Hub route is registered, and /contact-hub and
 * /contact-hub/person/:id fall through to the app's catch-all like any
 * unknown URL. With it on, they exist: My People (optionally filtered by a
 * sticker, /contact-hub?sticker=<id>), the Sticker Wall and a person.
 *
 * My People and the Sticker Wall are one screen at two addresses, so search,
 * the chosen view and the page's own state carry across.
 *
 * A function rather than JSX written into App.jsx so the guarantee is
 * testable on its own, with a real router, against the real switch
 * (src/test/contactHubRoutes.test.jsx).
 */
import { Route } from 'react-router-dom';
import { CONTACT_HUB, CONTACT_HUB_PATH, CONTACT_HUB_STICKERS_SEGMENT } from '../../constants/contactHub';
import ContactHubMain from './ContactHubMain';
import HubPeople from './HubPeople';
import HubPerson from './HubPerson';

export function contactHubRoutes() {
  if (!CONTACT_HUB.enabled) return null;
  return (
    <Route path={CONTACT_HUB_PATH} element={<ContactHubMain />}>
      <Route index element={<HubPeople />} />
      <Route path={CONTACT_HUB_STICKERS_SEGMENT} element={<HubPeople />} />
      <Route path="person/:contactId" element={<HubPerson />} />
    </Route>
  );
}
