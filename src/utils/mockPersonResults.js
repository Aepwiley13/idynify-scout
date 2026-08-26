/**
 * MOCK PERSON RESULTS — fixture for the Gate 3 selection experience.
 *
 * ⚠️  MOCK. Replaced by real people search when that is wired. Deliberately
 * includes identifiers in MIXED CASE and with URL noise so the raw pass-through
 * rule is exercised by the demo itself, not only by the tests:
 *
 *   · emails with capitals and a plus-tag
 *   · LinkedIn URLs with trailing slashes, query strings and www
 *   · phone numbers in three different human formats
 *
 * If anything in the UI ever normalises, it becomes visible here immediately.
 */

export const MOCK_PEOPLE = [
  { name: 'Sarah Chen',      title: 'VP of Operations',     company_name: 'Northwind Logistics', email: 'S.Chen@Northwind.com',        linkedin_url: 'https://www.linkedin.com/in/sarahchen/',        phone: '(415) 555-0198', apollo_person_id: 'apl_p_8812', apollo_organization_id: 'apl_o_4410' },
  { name: 'Marcus Webb',     title: 'Director of Finance',  company_name: 'Bridgeline Capital',  email: 'Marcus.Webb+idynify@Bridgeline.io', linkedin_url: 'http://linkedin.com/in/marcus-webb?trk=nav', phone: '+1-628-555-0114', apollo_person_id: 'apl_p_8813', apollo_organization_id: 'apl_o_4411' },
  { name: 'Priya Raman',     title: 'Head of People',       company_name: 'Aurora Health',       email: 'praman@AuroraHealth.org',     linkedin_url: 'https://linkedin.com/in/priyaraman',            phone: '415.555.0142',   apollo_person_id: 'apl_p_8814', apollo_organization_id: 'apl_o_4412' },
  { name: 'Tom Okafor',      title: 'COO',                  company_name: 'Cedar Manufacturing', email: 'tom@cedarmfg.com',            linkedin_url: 'https://www.linkedin.com/in/tomokafor/',        phone: '(510) 555-0177', apollo_person_id: 'apl_p_8815', apollo_organization_id: 'apl_o_4413' },
  { name: 'Elena Vasquez',   title: 'VP Revenue Operations', company_name: 'Meridian Software',  email: 'Elena.Vasquez@Meridian.co',   linkedin_url: 'https://www.linkedin.com/in/elenavasquez',      phone: '+1 (628) 555-0155', apollo_person_id: 'apl_p_8816', apollo_organization_id: 'apl_o_4414' },
  { name: 'Daniel Brooks',   title: 'Operations Manager',   company_name: 'Harborview Group',    email: null,                          linkedin_url: null,                                            phone: null,             apollo_person_id: null,         apollo_organization_id: 'apl_o_4415' },
  { name: 'Aisha Nkemdirim', title: 'Chief of Staff',       company_name: 'Lattice Partners',    email: 'aisha@latticepartners.com',   linkedin_url: 'https://www.linkedin.com/in/aishank/',         phone: '(415) 555-0121', apollo_person_id: 'apl_p_8818', apollo_organization_id: 'apl_o_4416' },
  { name: 'Sarah Johnson',   title: 'Director of Ops',      company_name: null,                  email: 'sarah.johnson@gmail.com',     linkedin_url: null,                                            phone: null,             apollo_person_id: 'apl_p_8819', apollo_organization_id: null },
];

export const MOCK_SOURCE = 'first_experience.person_search.mock';
