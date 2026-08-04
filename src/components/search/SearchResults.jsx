/**
 * SearchResults — the grouped result body shared by Mission Control's inline
 * Quick Search and the global command bar.
 *
 * Extracted from QuickSearch.jsx (PR #506) unchanged: same sections, same row
 * design, same ordering, same states, same option ids. Only the panel AROUND
 * this content differs between the two containers — an absolutely positioned
 * dropdown inline, a centred overlay panel globally — so the panel element,
 * its role="listbox" and its scroll container stay with each container.
 *
 * The `size` prop is the one addition: the overlay is the primary surface and
 * runs a little larger than the inline dropdown.
 */

import { User, Building2, Loader } from 'lucide-react';
import { BRAND } from '../../theme/tokens';
import { contactName as getContactName, companyName as getCompanyName } from './useQuickSearch';

// Carried over from PR #506 verbatim. Deliberately not remapped onto BRAND
// tokens: these are identity colours for initials avatars, picked to stay
// distinguishable from each other rather than to carry brand meaning, and
// changing them would silently restyle every existing result row.
const AVATAR_COLORS = [
  '#e85d7a', '#7c3aed', '#0ea5e9', '#10b981',
  '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
];

function getAvatarColor(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  compact:     { avatar: 34, rowPad: '10px 16px', name: 13, sub: 12, gap: 12, headerPad: '10px 16px 6px' },
  comfortable: { avatar: 38, rowPad: '12px 18px', name: 14, sub: 12.5, gap: 13, headerPad: '12px 18px 6px' },
};

function SectionHeader({ label, T, size }) {
  return (
    <div style={{
      padding: size.headerPad,
      fontSize: 10,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: T.textFaint,
    }}>
      {label}
    </div>
  );
}

function ResultRow({ id, isHighlighted, onSelect, onHighlight, T, size, children }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={isHighlighted}
      onClick={onSelect}
      onMouseEnter={onHighlight}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: size.gap,
        padding: size.rowPad,
        cursor: 'pointer',
        background: isHighlighted ? (T.isDark ? '#ffffff08' : '#00000006') : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {children}
    </div>
  );
}

export default function SearchResults({
  contactResults,
  companyResults,
  searchLoading,
  searchError,
  highlightIndex,
  onHighlight,
  onSelectContact,
  onSelectCompany,
  T,
  idPrefix = 'qs',
  size = 'compact',
}) {
  const S = SIZES[size] || SIZES.compact;
  const hasResults = contactResults.length > 0 || companyResults.length > 0;
  let resultIndex = 0;

  return (
    <>
      {searchLoading && !hasResults && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '24px 16px', color: T.textMuted, fontSize: 13,
        }}>
          <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
          Searching...
        </div>
      )}

      {searchError && !hasResults && (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
          Search could not be completed. Try again.
        </div>
      )}

      {!searchLoading && !searchError && !hasResults && (
        <div style={{ padding: '24px 16px', textAlign: 'center' }}>
          <div style={{ color: T.textMuted, fontSize: 13, marginBottom: 4 }}>
            No matching contacts or companies
          </div>
          <div style={{ color: T.textFaint, fontSize: 12 }}>
            Try a different name, company, email, or domain.
          </div>
        </div>
      )}

      {contactResults.length > 0 && (
        <div>
          <SectionHeader label="Contacts" T={T} size={S} />
          {contactResults.map((contact) => {
            const idx = resultIndex++;
            const name = getContactName(contact) || 'Unknown';
            const subtitle = [contact.title, contact.company].filter(Boolean).join(' · ');
            const isHighlighted = idx === highlightIndex;
            return (
              <ResultRow
                key={`c-${contact.id}`}
                id={`${idPrefix}-item-${idx}`}
                isHighlighted={isHighlighted}
                onSelect={() => onSelectContact(contact)}
                onHighlight={() => onHighlight(idx)}
                T={T}
                size={S}
              >
                {contact.photo_url ? (
                  <img
                    src={contact.photo_url}
                    alt=""
                    style={{
                      width: S.avatar, height: S.avatar, borderRadius: '50%',
                      objectFit: 'cover', flexShrink: 0,
                    }}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                  />
                ) : null}
                <div
                  style={{
                    width: S.avatar, height: S.avatar, borderRadius: '50%',
                    background: `${getAvatarColor(name)}20`,
                    border: `1px solid ${getAvatarColor(name)}40`,
                    display: contact.photo_url ? 'none' : 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, color: getAvatarColor(name),
                    flexShrink: 0,
                  }}
                >
                  {getInitials(name)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: S.name, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {name}
                  </div>
                  {subtitle && (
                    <div style={{ fontSize: S.sub, color: T.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                      {subtitle}
                    </div>
                  )}
                </div>
                <User size={14} color={T.textFaint} style={{ flexShrink: 0 }} />
              </ResultRow>
            );
          })}
        </div>
      )}

      {companyResults.length > 0 && (
        <div>
          {contactResults.length > 0 && (
            <div style={{ borderTop: `1px solid ${T.border}`, margin: '4px 0' }} />
          )}
          <SectionHeader label="Companies" T={T} size={S} />
          {companyResults.map((company) => {
            const idx = resultIndex++;
            const name = getCompanyName(company) || 'Unknown';
            const secondary = [company.industry, company.domain || company.website].filter(Boolean).join(' · ');
            const isHighlighted = idx === highlightIndex;
            return (
              <ResultRow
                key={`co-${company.id}`}
                id={`${idPrefix}-item-${idx}`}
                isHighlighted={isHighlighted}
                onSelect={() => onSelectCompany(company)}
                onHighlight={() => onHighlight(idx)}
                T={T}
                size={S}
              >
                <div style={{
                  width: S.avatar, height: S.avatar, borderRadius: '50%',
                  background: `${BRAND.cyan}15`,
                  border: `1px solid ${BRAND.cyan}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: BRAND.cyan,
                  flexShrink: 0,
                }}>
                  {getInitials(name)}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: S.name, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {name}
                  </div>
                  {secondary && (
                    <div style={{ fontSize: S.sub, color: T.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                      {secondary}
                    </div>
                  )}
                </div>
                <Building2 size={14} color={T.textFaint} style={{ flexShrink: 0 }} />
              </ResultRow>
            );
          })}
        </div>
      )}

      {searchLoading && hasResults && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 6, padding: '8px 16px', borderTop: `1px solid ${T.border}`,
          color: T.textFaint, fontSize: 11,
        }}>
          <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />
          Loading more...
        </div>
      )}
    </>
  );
}
