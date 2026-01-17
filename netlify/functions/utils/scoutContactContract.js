/**
 * SCOUT CONTACT DATA CONTRACT
 *
 * This defines the REQUIRED data shape for contacts used in Scout.
 *
 * ⚠️  CRITICAL: DO NOT modify these field names without updating the frontend!
 *
 * WHY THIS EXISTS:
 * - Documents expected data structure for Scout contacts
 * - Prevents accidental breaking changes
 * - Provides validation to catch Apollo API changes
 * - Centralizes field mapping logic
 *
 * HISTORY:
 * - Phase 0: Apollo deprecated /mixed_people/search
 * - Phase 1: Fixed to use /api_search + /people/match with proper field mapping
 * - Phase 2: Documented contract to prevent future regressions
 *
 * Last updated: Phase 2 - January 2026
 */

/**
 * SCOUT CONTACT FIELD SPECIFICATION
 *
 * Frontend expects these fields in CompanyDetail.jsx:
 * - contact.name (for display)
 * - contact.photo_url (for avatar)
 * - contact.linkedin_url (for LinkedIn button)
 * - contact.title (for job title)
 * - contact.email (hidden from Available Contacts, shown in All Leads)
 * - contact.seniority (for badge)
 * - contact.departments (for department badge)
 */
export const SCOUT_CONTACT_FIELDS = {
  // REQUIRED FIELDS (must always be present, even if null)
  id: 'string',               // Apollo person ID (required for enrichment)
  name: 'string|null',        // Full name (mapped from first_name + last_name)
  title: 'string|null',       // Job title

  // ENRICHMENT FIELDS (may be null if Apollo lacks data)
  email: 'string|null',       // Email address
  photo_url: 'string|null',   // Profile photo URL
  linkedin_url: 'string|null', // LinkedIn profile URL

  // METADATA FIELDS
  first_name: 'string|null',  // First name (for fallback display)
  last_name: 'string|null',   // Last name (for fallback display)
  seniority: 'string|null',   // Seniority level (director, vp, c_suite, etc.)
  departments: 'array',       // Array of department strings (or functions)
  phone_numbers: 'array',     // Array of phone number strings
  organization_name: 'string|null' // Company name
};

/**
 * Validates a contact object against the Scout contract
 *
 * @param {object} contact - Contact object to validate
 * @returns {object} - Validation result { valid: boolean, errors: array }
 */
export function validateScoutContact(contact) {
  const errors = [];

  // Check required fields exist
  if (!contact) {
    errors.push('Contact object is null or undefined');
    return { valid: false, errors };
  }

  if (!contact.id) {
    errors.push('Missing required field: id');
  }

  if (contact.name === undefined) {
    errors.push('Missing required field: name (can be null, but must be defined)');
  }

  if (contact.title === undefined) {
    errors.push('Missing required field: title (can be null, but must be defined)');
  }

  // Check arrays are actually arrays
  if (contact.departments !== undefined && !Array.isArray(contact.departments)) {
    errors.push('departments must be an array');
  }

  if (contact.phone_numbers !== undefined && !Array.isArray(contact.phone_numbers)) {
    errors.push('phone_numbers must be an array');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Maps raw Apollo API response to Scout contact format
 *
 * This is the CANONICAL mapper used by all Scout functions.
 * All contact mapping MUST use this function to ensure consistency.
 *
 * @param {object} apolloPerson - Raw person object from Apollo API
 * @returns {object} - Scout-formatted contact
 */
export function mapApolloToScoutContact(apolloPerson) {
  if (!apolloPerson) {
    console.warn('⚠️  mapApolloToScoutContact called with null/undefined person');
    return null;
  }

  // Construct full name from first_name + last_name if name field doesn't exist
  // This is the fix from Phase 1 - Apollo /api_search returns separate fields
  const fullName = apolloPerson.name ||
    `${apolloPerson.first_name || ''} ${apolloPerson.last_name || ''}`.trim() ||
    null;

  const mappedContact = {
    // Copy all Apollo fields (preserve everything)
    ...apolloPerson,

    // Ensure required field mappings
    name: fullName,
    email: apolloPerson.email || null,
    photo_url: apolloPerson.photo_url || null,
    linkedin_url: apolloPerson.linkedin_url || null,

    // Organization name mapping (Apollo sometimes returns nested object)
    organization_name: apolloPerson.organization_name ||
                      apolloPerson.organization?.name ||
                      null,

    // Departments (Apollo calls these "functions" sometimes)
    departments: apolloPerson.departments || apolloPerson.functions || [],

    // Phone numbers
    phone_numbers: apolloPerson.phone_numbers || []
  };

  return mappedContact;
}

/**
 * Logs validation errors with helpful context
 *
 * @param {object} validationResult - Result from validateScoutContact()
 * @param {object} contact - The contact that failed validation
 * @param {string} functionName - Name of calling function
 */
export function logValidationErrors(validationResult, contact, functionName) {
  if (validationResult.valid) return;

  console.warn('┌─────────────────────────────────────────────────');
  console.warn(`│ ⚠️  Contact validation failed in ${functionName}`);
  console.warn('├─────────────────────────────────────────────────');
  validationResult.errors.forEach(error => {
    console.warn(`│   - ${error}`);
  });
  console.warn('├─────────────────────────────────────────────────');
  console.warn('│ Contact data:');
  console.warn(`│   ID: ${contact?.id || '(missing)'}`);
  console.warn(`│   Name: ${contact?.name || '(missing)'}`);
  console.warn(`│   Title: ${contact?.title || '(missing)'}`);
  console.warn('└─────────────────────────────────────────────────');
}
