/**
 * PeopleSection — Archived/lost people in FallBack.
 * Shows contacts with status 'people_mode_archived' or 'people_mode_skipped'.
 */
import AllLeads from '../../Scout/AllLeads';

export default function PeopleSection() {
  return <AllLeads mode="fallback" />;
}
