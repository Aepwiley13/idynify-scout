/**
 * Title synonym map for Apollo people search.
 * Each entry maps a canonical title to up to 4 variants (including itself).
 * Variants are passed to Apollo's person_titles parameter to improve match coverage.
 *
 * Apollo does not guarantee synonym expansion — this map handles it on our side.
 * Cap: 4 variants per title to control API result volume.
 *
 * To add new titles: append to TITLE_SYNONYMS and the expansion will pick them up automatically.
 */
export const TITLE_SYNONYMS = {
  // Founder variants
  'Founder': ['Founder', 'Co-Founder', 'Co Founder', 'Founding Partner'],
  'Co-Founder': ['Co-Founder', 'Founder', 'Co Founder', 'Founding Partner'],
  'Co Founder': ['Co Founder', 'Co-Founder', 'Founder', 'Founding Partner'],

  // CEO variants
  'CEO': ['CEO', 'Chief Executive Officer', 'Chief Executive', 'Co-CEO'],
  'Chief Executive Officer': ['Chief Executive Officer', 'CEO', 'Chief Executive', 'Co-CEO'],

  // COO variants
  'COO': ['COO', 'Chief Operating Officer', 'Chief Operations Officer', 'Chief of Operations'],
  'Chief Operating Officer': ['Chief Operating Officer', 'COO', 'Chief Operations Officer', 'Chief of Operations'],

  // CTO variants
  'CTO': ['CTO', 'Chief Technology Officer', 'Chief Technical Officer', 'VP Engineering'],
  'Chief Technology Officer': ['Chief Technology Officer', 'CTO', 'Chief Technical Officer', 'VP Engineering'],

  // CMO variants
  'CMO': ['CMO', 'Chief Marketing Officer', 'VP Marketing', 'Head of Marketing'],
  'Chief Marketing Officer': ['Chief Marketing Officer', 'CMO', 'VP Marketing', 'Head of Marketing'],

  // CFO variants
  'CFO': ['CFO', 'Chief Financial Officer', 'VP Finance', 'Head of Finance'],
  'Chief Financial Officer': ['Chief Financial Officer', 'CFO', 'VP Finance', 'Head of Finance'],

  // President variants
  'President': ['President', 'Co-President', 'President & CEO', 'Managing Director'],

  // VP Sales variants
  'VP Sales': ['VP Sales', 'VP of Sales', 'Vice President Sales', 'Vice President of Sales'],
  'VP of Sales': ['VP of Sales', 'VP Sales', 'Vice President of Sales', 'Vice President Sales'],
  'Vice President Sales': ['Vice President Sales', 'VP Sales', 'VP of Sales', 'Vice President of Sales'],
  'Vice President of Sales': ['Vice President of Sales', 'VP of Sales', 'VP Sales', 'Vice President Sales'],

  // Director of Sales variants
  'Director of Sales': ['Director of Sales', 'Sales Director', 'Director, Sales', 'Senior Director of Sales'],
  'Sales Director': ['Sales Director', 'Director of Sales', 'Director, Sales', 'Senior Director of Sales'],

  // Head of Sales variants
  'Head of Sales': ['Head of Sales', 'Sales Lead', 'Sales Manager', 'VP Sales'],
  'Head of Revenue': ['Head of Revenue', 'VP Revenue', 'Chief Revenue Officer', 'CRO'],

  // RevOps
  'Head of RevOps': ['Head of RevOps', 'Head of Revenue Operations', 'VP Revenue Operations', 'Director of RevOps'],
  'Head of Revenue Operations': ['Head of Revenue Operations', 'Head of RevOps', 'VP Revenue Operations', 'Director of Revenue Operations'],
  'VP Revenue Operations': ['VP Revenue Operations', 'VP RevOps', 'Head of Revenue Operations', 'Head of RevOps'],

  // CRO
  'CRO': ['CRO', 'Chief Revenue Officer', 'Head of Revenue', 'VP Revenue'],
  'Chief Revenue Officer': ['Chief Revenue Officer', 'CRO', 'Head of Revenue', 'VP Revenue'],

  // Owner
  'Owner': ['Owner', 'Business Owner', 'Founder', 'Principal'],
  'Business Owner': ['Business Owner', 'Owner', 'Founder', 'Principal'],

  // Managing Director
  'Managing Director': ['Managing Director', 'MD', 'General Manager', 'President'],

  // General Manager
  'General Manager': ['General Manager', 'GM', 'Managing Director', 'VP Operations'],
};

/**
 * Expand a list of target titles to include known synonyms.
 * Deduplicates across all expanded titles.
 * Each title is expanded to at most 4 variants (cap enforced here).
 *
 * @param {string[]} titles - Array of canonical title strings from user's ICP
 * @param {number} [variantCap=4] - Max variants per title
 * @returns {string[]} Deduplicated array of titles + all variants
 */
export function expandTitlesWithSynonyms(titles, variantCap = 4) {
  if (!titles || titles.length === 0) return [];

  const seen = new Set();
  const expanded = [];

  for (const title of titles) {
    const variants = TITLE_SYNONYMS[title] || [title];
    const capped = variants.slice(0, variantCap);

    for (const variant of capped) {
      const key = variant.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        expanded.push(variant);
      }
    }
  }

  return expanded;
}
