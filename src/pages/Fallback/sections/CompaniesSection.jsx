/**
 * CompaniesSection — Archived/lost companies in FallBack.
 * Shows companies with status 'archived'.
 */
import SharedCompaniesView from '../../../components/shared/SharedCompaniesView';

export default function CompaniesSection() {
  return <SharedCompaniesView mode="fallback" />;
}
