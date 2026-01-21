import { useState, useEffect, useRef } from 'react';
import { Building2 } from 'lucide-react';

// Session-level cache to remember Clearbit failures
// Prevents repeated network requests for known failures
const clearbitFailureCache = new Set();

/**
 * CompanyLogo - Robust logo rendering with multi-source fallback
 *
 * Resolution order (Hybrid approach - best of both worlds):
 * 1. Direct logo_url from backend (if exists)
 * 2. Apollo enrichment logo URL (if exists)
 * 3. Clearbit Logo API (https://logo.clearbit.com/{domain}) - attempted once per session
 * 4. Company initial (single letter - matches Manual Search clean feel)
 */
export default function CompanyLogo({ company, size = 'default', className = '' }) {
  const [logoSrc, setLogoSrc] = useState(null);
  const [logoType, setLogoType] = useState(null); // 'direct' | 'apollo' | 'clearbit' | 'initials'
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

  // Extract company initial for fallback (single letter - matches Manual Search)
  const getCompanyInitial = (name) => {
    if (!name) return '?';
    return name.charAt(0).toUpperCase();
  };

  const initial = getCompanyInitial(company.name);

  // Resolve logo source (Hybrid approach)
  useEffect(() => {
    setLogoLoading(true);

    console.log('🔍 CompanyLogo: Resolving logo for', company.name);

    // Priority 1: Direct logo_url from backend (most reliable)
    if (company.logo_url) {
      console.log('✅ Using direct logo_url:', company.logo_url);
      setLogoSrc(company.logo_url);
      setLogoType('direct');
      setLogoLoading(false);
      return;
    }

    // Priority 2: Apollo enrichment logo (if available)
    const apolloLogo = company.apolloEnrichment?.snapshot?.logo_url;
    if (apolloLogo) {
      console.log('✅ Using Apollo enrichment logo:', apolloLogo);
      setLogoSrc(apolloLogo);
      setLogoType('apollo');
      setLogoLoading(false);
      return;
    }

    // Priority 3: Clearbit logo via domain (only if not previously failed)
    const domain = company.domain || company.website_url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];

    if (domain && !clearbitFailureCache.has(domain) && !clearbitAttemptedRef.current) {
      console.log('🌐 Trying Clearbit for domain:', domain);
      // Attempt Clearbit once
      clearbitAttemptedRef.current = true;
      setLogoSrc(`https://logo.clearbit.com/${domain}`);
      setLogoType('clearbit');
      setLogoLoading(false);
      return;
    }

    // Priority 4: Use single letter fallback
    console.log('💭 Using single letter fallback');
    setLogoSrc(null);
    setLogoType('initials');
    setLogoLoading(false);
  }, [company]);

  const handleLogoError = () => {
    // If direct logo_url failed, try Apollo enrichment
    if (logoType === 'direct') {
      const apolloLogo = company.apolloEnrichment?.snapshot?.logo_url;
      if (apolloLogo) {
        setLogoSrc(apolloLogo);
        setLogoType('apollo');
        return;
      }
    }

    // If Apollo failed, try Clearbit
    if (logoType === 'apollo' || logoType === 'direct') {
      const domain = company.domain || company.website_url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
      if (domain && !clearbitFailureCache.has(domain)) {
        setLogoSrc(`https://logo.clearbit.com/${domain}`);
        setLogoType('clearbit');
        return;
      }
    }

    // Mark Clearbit as failed for this domain
    const domain = company.domain || company.website_url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    if (domain && logoType === 'clearbit') {
      clearbitFailureCache.add(domain);
    }

    // Final fallback: single letter initial
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

  // Fallback: Company initial (single letter - matches Manual Search)
  return (
    <div className={`${sizeClasses[size]} ${className} bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center text-white font-bold shadow-sm`}>
      {initial}
    </div>
  );
}
