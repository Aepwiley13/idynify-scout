/**
 * CompaniesSection — Companies view in Hunter.
 * Uses SharedCompaniesView with mode='hunter' to show only companies
 * that have Hunter-engaged contacts, in the consistent card design.
 */
import SharedCompaniesView from '../../../components/shared/SharedCompaniesView';

export default function CompaniesSection() {
  return <SharedCompaniesView mode="hunter" />;
}
