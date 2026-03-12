/**
 * SniperCompaniesSection — Companies view in Sniper.
 * Uses SharedCompaniesView with mode='sniper' to show only companies
 * associated with Sniper pipeline contacts, in the consistent card design.
 */
import SharedCompaniesView from '../../../components/shared/SharedCompaniesView';

export default function SniperCompaniesSection() {
  return <SharedCompaniesView mode="sniper" />;
}
