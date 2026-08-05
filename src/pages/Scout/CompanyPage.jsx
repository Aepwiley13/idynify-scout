/**
 * CompanyPage — the canonical company destination at /company/:companyId.
 *
 * The company half of the same contract ContactPage implements: a
 * module-agnostic route that renders CompanyDetail without mounting Scout,
 * reads the ephemeral navigation intent, tells the shell where the user came
 * from so the breadcrumb names the real origin, and hands CompanyDetail a way
 * back that is not a hardcoded guess at Scout.
 *
 * Companies have no arrival banner. The banner exists to restate a REASON a
 * record was surfaced, and company navigation is user-initiated — a search
 * result, a link from a contact — rather than engine-recommended. There is
 * nothing to explain, so nothing is shown. The intent still travels: the
 * breadcrumb and the Back destination both come from it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getEffectiveUser } from '../../context/ImpersonationContext';
import { useArrival, useShellEntity } from '../../context/ShellContext';
import { readNavigationIntent, originModuleId } from '../../utils/navigation';
import { resolveDestination, resolveModule } from '../../constants/navigationModel';
import CompanyDetail from './CompanyDetail';

export default function CompanyPage() {
  const { companyId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [summary, setSummary] = useState(null);
  const containerRef = useRef(null);

  const intent = useMemo(
    () => readNavigationIntent(location, { entityType: 'company', entityId: companyId }),
    [location, companyId],
  );

  const origin = originModuleId(intent, resolveModule);
  const originDestination = resolveDestination(origin);

  useArrival({
    intent,
    originModuleId: origin,
    sessionKey: companyId
      ? { entityType: 'company', entityId: companyId, sessionType: 'company_review', sourceModule: intent?.entryPoint ?? 'direct' }
      : null,
    memoryLoaded: false,
  });

  // A light read for the breadcrumb's entity segment; CompanyDetail loads the
  // full record itself.
  useEffect(() => {
    let cancelled = false;
    const user = getEffectiveUser();
    if (!user || !companyId) return undefined;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'companies', companyId));
        if (!cancelled && snap.exists()) setSummary({ id: snap.id, ...snap.data() });
      } catch (err) {
        console.warn('[CompanyPage] summary load failed:', err.message);
      }
    })();

    return () => { cancelled = true; };
  }, [companyId]);

  useShellEntity({
    type: 'company',
    id: companyId,
    stage: null,
    label: summary?.name ?? summary?.company_name ?? null,
  });

  // Focus the page container on arrival so keyboard and screen-reader users
  // start at the record rather than wherever the previous screen left them.
  useEffect(() => {
    containerRef.current?.focus();
  }, [companyId]);

  const returnTo = intent?.returnTo ?? null;
  const backLabel = originDestination ? `Back to ${originDestination.label}` : 'Back to Scout';

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="canonical-company-page"
      aria-label={summary ? `Company — ${summary.name ?? summary.company_name}` : 'Company'}
      style={{ outline: 'none' }}
    >
      <CompanyDetail
        companyId={companyId}
        returnTo={returnTo}
        returnLabel={backLabel}
        banner={returnTo ? (
          <button
            type="button"
            onClick={() => navigate(returnTo)}
            aria-label={backLabel}
            className="canonical-back-button"
          >
            ← {backLabel}
          </button>
        ) : null}
      />
    </div>
  );
}
