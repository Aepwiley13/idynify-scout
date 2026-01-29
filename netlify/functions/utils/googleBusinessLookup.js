/**
 * GOOGLE BUSINESS LOOKUP UTILITY
 *
 * Company-level fallback enrichment using Google Places API.
 *
 * PURPOSE:
 * When Apollo doesn't return company-level data (phone, address, website),
 * Google Places fills the gap with publicly available business information.
 *
 * IMPORTANT DISTINCTION:
 * - Google = COMPANY-level data (phone, address, website, hours)
 * - Apollo = PERSON-level data (email, title, seniority, LinkedIn)
 * - These never overlap. Google does NOT return person data.
 *
 * TRIGGER CONDITIONS:
 * Only runs if Apollo is missing:
 *   - Company phone
 *   - Company website
 *   - HQ location / address
 *
 * COST: Google Places API — minimal per-request cost, no AI tokens.
 *
 * Last updated: January 2026
 */

/**
 * Look up company-level data from Google Places API.
 *
 * @param {object} params
 * @param {string} params.companyName - Company name (required)
 * @param {string} [params.domain] - Company domain (optional, improves matching)
 * @param {string} [params.city] - City hint (optional)
 * @param {string} [params.state] - State hint (optional)
 * @returns {Promise<object>} - { data, fieldsFound, source }
 */
export async function googleBusinessLookup({ companyName, domain, city, state }) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.warn('⚠️  GOOGLE_PLACES_API_KEY not configured, skipping Google Business lookup');
    return { data: {}, fieldsFound: [], source: 'google_places', status: 'skipped', message: 'Google Places API key not configured' };
  }

  if (!companyName) {
    return { data: {}, fieldsFound: [], source: 'google_places', status: 'skipped', message: 'No company name provided' };
  }

  try {
    // Build search query with location hints
    let query = companyName;
    if (city && state) {
      query += ` ${city} ${state}`;
    } else if (city) {
      query += ` ${city}`;
    } else if (state) {
      query += ` ${state}`;
    }

    console.log('🔍 Google Places: Searching for:', query);

    // Step 1: Find Place from Text
    const findPlaceUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name,formatted_address,business_status&key=${apiKey}`;

    const findResponse = await fetch(findPlaceUrl);

    if (!findResponse.ok) {
      throw new Error(`Google Places API returned ${findResponse.status}`);
    }

    const findData = await findResponse.json();

    if (findData.status !== 'OK' || !findData.candidates || findData.candidates.length === 0) {
      console.log('🔍 Google Places: No results found');
      return { data: {}, fieldsFound: [], source: 'google_places', status: 'no_results', message: 'No business found on Google' };
    }

    const placeId = findData.candidates[0].place_id;

    // Step 2: Get Place Details
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,international_phone_number,website,url,address_components,types,business_status,opening_hours&key=${apiKey}`;

    const detailsResponse = await fetch(detailsUrl);

    if (!detailsResponse.ok) {
      throw new Error(`Google Places Details API returned ${detailsResponse.status}`);
    }

    const detailsData = await detailsResponse.json();

    if (detailsData.status !== 'OK' || !detailsData.result) {
      return { data: {}, fieldsFound: [], source: 'google_places', status: 'no_data', message: 'Google returned place but no details' };
    }

    const place = detailsData.result;
    const data = {};
    const fieldsFound = [];

    // Extract company phone
    if (place.international_phone_number || place.formatted_phone_number) {
      data.company_phone = place.international_phone_number || place.formatted_phone_number;
      fieldsFound.push('company_phone');
    }

    // Extract website
    if (place.website) {
      data.company_website = place.website;
      fieldsFound.push('company_website');
    }

    // Extract address
    if (place.formatted_address) {
      data.company_address = place.formatted_address;
      fieldsFound.push('company_address');

      // Parse address components for structured location
      if (place.address_components) {
        for (const component of place.address_components) {
          if (component.types.includes('locality')) {
            data.company_city = component.long_name;
          }
          if (component.types.includes('administrative_area_level_1')) {
            data.company_state = component.short_name;
          }
          if (component.types.includes('country')) {
            data.company_country = component.long_name;
          }
          if (component.types.includes('postal_code')) {
            data.company_zip = component.long_name;
          }
        }
      }
    }

    // Extract Google Maps URL
    if (place.url) {
      data.google_maps_url = place.url;
      fieldsFound.push('google_maps_url');
    }

    // Business status
    if (place.business_status) {
      data.business_status = place.business_status; // OPERATIONAL, CLOSED_TEMPORARILY, etc.
    }

    console.log(`✅ Google Places: Found ${fieldsFound.length} fields for "${companyName}"`);

    return {
      data,
      fieldsFound,
      source: 'google_places',
      status: 'success',
      message: null
    };

  } catch (error) {
    console.error('❌ Google Places lookup failed:', error.message);
    return {
      data: {},
      fieldsFound: [],
      source: 'google_places',
      status: 'error',
      message: error.message
    };
  }
}
