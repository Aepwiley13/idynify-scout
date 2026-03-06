/**
 * SniperCompaniesSection.jsx — Companies view for SNIPER.
 *
 * Shows all saved companies (status=accepted) from Scout, with SNIPER
 * context: highlights companies that have contacts already in the pipeline.
 * Reuses SavedCompanies component directly.
 */
import SavedCompanies from '../../Scout/SavedCompanies';

export default function SniperCompaniesSection() {
  return <SavedCompanies />;
}
