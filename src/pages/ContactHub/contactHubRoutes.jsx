/**
 * Contact Hub's routes, and the one decision about whether they exist.
 *
 * App.jsx calls contactHubRoutes() inside its shell route group. With the
 * switch off (the default, constants/contactHub.js) it returns null: no
 * Contact Hub route is registered, and /contact-hub and
 * /contact-hub/person/:id fall through to the app's catch-all like any
 * unknown URL. With it on, both exist.
 *
 * A function rather than JSX written into App.jsx so the guarantee is
 * testable on its own, with a real router, against the real switch
 * (src/test/contactHubRoutes.test.jsx).
 */
import { Route } from 'react-router-dom';
import { CONTACT_HUB, CONTACT_HUB_PATH } from '../../constants/contactHub';
import ContactHubMain from './ContactHubMain';
import HubPeople from './HubPeople';
import HubPerson from './HubPerson';

export function contactHubRoutes() {
  if (!CONTACT_HUB.enabled) return null;
  return (
    <Route path={CONTACT_HUB_PATH} element={<ContactHubMain />}>
      <Route index element={<HubPeople />} />
      <Route path="person/:contactId" element={<HubPerson />} />
    </Route>
  );
}
