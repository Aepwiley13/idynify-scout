/**
 * CompaniesSection — Companies view in Basecamp.
 * Uses SharedCompaniesView with mode='all' to show all customer companies.
 */
import SharedCompaniesView from '../../../components/shared/SharedCompaniesView';

export default function CompaniesSection() {
  return <SharedCompaniesView mode="all" />;
}
