/**
 * PeopleSection — Archived/lost people in FallBack.
 *
 * Shows contacts carrying an archive signal: `is_archived`, `status:
 * 'archived'` or `status: 'people_mode_archived'`.
 *
 * It deliberately does NOT show `people_mode_skipped`. A people-mode skip
 * defers someone to a later day — DailyLeads re-offers them whenever
 * `skipped_date !== today` — so they are still in play, not lost. This file
 * used to say otherwise, and that sentence was the whole of the product
 * decision it claimed: skipped people were listed here as if the user had
 * rejected them. See `isDeferredRecord` in src/constants/statusModel.js.
 */
import AllLeads from '../../Scout/AllLeads';

export default function PeopleSection() {
  return <AllLeads mode="fallback" />;
}
