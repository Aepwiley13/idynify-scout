/**
 * The Company Snapshot's facts and their formatting, shared by the company
 * detail modal and the company profile page (CompanyInfoSections.jsx).
 */
import { Briefcase, Users, DollarSign, Calendar, MapPin, Phone } from 'lucide-react';
import { getDisplayIndustry } from '../../utils/companyDisplay';

export function formatRevenue(value) {
  if (!value) return null;
  const num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) : value;
  if (isNaN(num) || num === 0) return String(value);
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
}

export function formatEmployees(value) {
  if (!value) return null;
  const num = typeof value === 'string' ? parseInt(value.replace(/[^0-9]/g, ''), 10) : value;
  if (isNaN(num) || num === 0) return String(value);
  return num.toLocaleString();
}

/** The six snapshot facts, from enrichment first and the stored company second. */
export function snapshotFacts(company, snapshot) {
  const snap = snapshot || {};
  return [
    ['Industry', getDisplayIndustry(company, 'Not available'), Briefcase],
    ['Employees', snap.employee_count_range
      || formatEmployees(snap.estimated_num_employees)
      || formatEmployees(company?.employee_count)
      || company?.company_size
      || 'Not available', Users],
    ['Revenue', snap.revenue_range
      || formatRevenue(snap.annual_revenue)
      || formatRevenue(company?.revenue)
      || 'Not available', DollarSign],
    ['Founded', snap.founded_year || company?.founded_year || 'Not available', Calendar],
    ['Address', snap.location?.full || company?.location || 'Not available', MapPin],
    ['Phone', snap.phone || 'Not available', Phone],
  ];
}
