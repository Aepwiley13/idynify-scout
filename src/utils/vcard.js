/**
 * Generate and download a vCard (.vcf) file for a contact
 * @param {Object} contact - Contact object with name, email, phone, etc.
 */
export function downloadVCard(contact) {
  // Build vCard content (vCard 3.0 format)
  const vCardLines = ['BEGIN:VCARD', 'VERSION:3.0'];

  // Name (required)
  if (contact.name) {
    // Split name into parts for N field (Family;Given;Middle;Prefix;Suffix)
    const nameParts = contact.name.trim().split(' ');
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const firstName = nameParts.length > 0 ? nameParts[0] : '';
    const middleNames = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';

    vCardLines.push(`N:${lastName};${firstName};${middleNames};;`);
    vCardLines.push(`FN:${contact.name}`);
  }

  // Organization
  if (contact.company_name || contact.company) {
    vCardLines.push(`ORG:${contact.company_name || contact.company}`);
  }

  // Title
  if (contact.title) {
    vCardLines.push(`TITLE:${contact.title}`);
  }

  // Email (prefer work_email, fallback to email)
  const email = contact.work_email || contact.email;
  if (email) {
    vCardLines.push(`EMAIL;TYPE=WORK:${email}`);
  }

  // Phone numbers
  if (contact.phone_mobile) {
    vCardLines.push(`TEL;TYPE=CELL:${contact.phone_mobile}`);
  }
  if (contact.phone_direct) {
    vCardLines.push(`TEL;TYPE=WORK,VOICE:${contact.phone_direct}`);
  }
  if (contact.phone_work && !contact.phone_direct) {
    vCardLines.push(`TEL;TYPE=WORK:${contact.phone_work}`);
  }
  if (contact.phone && !contact.phone_mobile && !contact.phone_direct && !contact.phone_work) {
    vCardLines.push(`TEL;TYPE=VOICE:${contact.phone}`);
  }

  // LinkedIn URL
  if (contact.linkedin_url) {
    vCardLines.push(`URL;TYPE=LINKEDIN:${contact.linkedin_url}`);
  }

  // Note with source information
  if (contact.source) {
    const sourceLabels = {
      manual: 'Added Manually',
      networking: 'Met at Networking Event',
      apollo: 'Found via Search',
      'Scanned Business Card': 'Scanned Business Card',
      'Found via Apollo': 'Found via Search'
    };
    const sourceLabel = sourceLabels[contact.source] || contact.source;
    vCardLines.push(`NOTE:Source: ${sourceLabel}`);
  }

  vCardLines.push('END:VCARD');

  // Join with CRLF (required by vCard spec)
  const vCardContent = vCardLines.join('\r\n');

  // Create blob and download
  const blob = new Blob([vCardContent], { type: 'text/vcard;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  // Generate filename from contact name
  const fileName = contact.name
    ? `${contact.name.replace(/\s+/g, '_')}.vcf`
    : 'contact.vcf';
  link.download = fileName;

  // Trigger download
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);

  console.log('📱 vCard downloaded:', fileName);
}
