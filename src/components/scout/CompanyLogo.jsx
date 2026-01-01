import { useState, useEffect, useRef } from 'react';
import { Building2 } from 'lucide-react';

// Session-level cache to remember Clearbit failures
// Prevents repeated network requests for known failures
const clearbitFailureCache = new Set();

/**
 * CompanyLogo - Robust logo rendering with multi-source fallback
 *
 * Resolution order:
 * 1. Apollo-provided logo URL (if exists)
 * 2. Clearbit Logo API (https://logo.clearbit.com/{domain}) - attempted once per session
 * 3. Company initials (first letter of each word)
 * 4. Fallback building icon
 */
export default function CompanyLogo({ company, size = 'default', className = '' }) {
  const [logoSrc, setLogoSrc] = useState(null);
  const [logoType, setLogoType] = useState(null); // 'apollo' | 'clearbit' | 'initials'
  const [logoLoading, setLogoLoading] = useState(true);
  const clearbitAttemptedRef = useRef(false);

  // Size variants
  const sizeClasses = {
    small: 'w-10 h-10 text-sm',
    default: 'w-16 h-16 text-base',
    large: 'w-20 h-20 text-xl'
  };

  const iconSizes = {
    small: 'w-5 h-5',
    default: 'w-8 h-8',
    large: 'w-10 h-10'
  };

  // Extract company initials for fallback
  const getCompanyInitials = (name) => {
    if (!name) return '?';

    // Split by spaces, take first letter of each word (max 2)
    const words = name.split(' ').filter(word => word.length > 0);
    if (words.length === 0) return '?';

    if (words.length === 1) {
      return words[0].charAt(0).toUpperCase();
    }

    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  };

  const initials = getCompanyInitials(company.name);

  // Resolve logo source
  useEffect(() => {
    setLogoLoading(true);

    // Priority 1: Apollo enrichment logo (if available)
    const apolloLogo = company.apolloEnrichment?.snapshot?.logo_url;
    if (apolloLogo) {
      setLogoSrc(apolloLogo);
      setLogoType('apollo');
      setLogoLoading(false);
      return;
    }

    // Priority 2: Clearbit logo via domain (only if not previously failed)
    const domain = company.domain || company.website_url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];

    if (domain && !clearbitFailureCache.has(domain) && !clearbitAttemptedRef.current) {
      // Attempt Clearbit once
      clearbitAttemptedRef.current = true;
      setLogoSrc(`https://logo.clearbit.com/${domain}`);
      setLogoType('clearbit');
      setLogoLoading(false);
      return;
    }

    // Priority 3: Use initials fallback immediately
    // (Either no domain, or Clearbit known to fail)
    setLogoSrc(null);
    setLogoType('initials');
    setLogoLoading(false);
  }, [company]);

  const handleLogoError = () => {
    // Mark Clearbit as failed for this domain
    const domain = company.domain || company.website_url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    if (domain && logoType === 'clearbit') {
      clearbitFailureCache.add(domain);
    }

    // Switch to initials fallback
    setLogoSrc(null);
    setLogoType('initials');
  };

  // Loading skeleton
  if (logoLoading) {
    return (
      <div className={`${sizeClasses[size]} ${className} bg-gray-200 rounded-xl animate-pulse flex items-center justify-center`}>
        <Building2 className={`${iconSizes[size]} text-gray-400`} />
      </div>
    );
  }

  // Show logo image if available
  if (logoSrc && logoType !== 'initials') {
    return (
      <div className={`${sizeClasses[size]} ${className} bg-white rounded-xl border border-gray-200 flex items-center justify-center overflow-hidden`}>
        <img
          src={logoSrc}
          alt={`${company.name} logo`}
          onError={handleLogoError}
          className="w-full h-full object-contain p-2"
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback: Company initials
  return (
    <div className={`${sizeClasses[size]} ${className} bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white font-bold shadow-sm`}>
      {initials}
    </div>
  );
}
