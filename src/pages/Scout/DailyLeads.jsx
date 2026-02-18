import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import CompanyCard from '../../components/scout/CompanyCard';
import PersonCard from '../../components/scout/PersonCard';
import ContactTitleSetup from '../../components/scout/ContactTitleSetup';
import { TrendingUp, TrendingDown, Target, Users, Filter, ChevronDown, CheckCircle, RotateCcw, RefreshCw, Loader, Settings } from 'lucide-react';
import './DailyLeads.css';

export default function DailyLeads() {
  const navigate = useNavigate();

  // ── Company Mode state ──────────────────────────────────────────────────────
  const [companies, setCompanies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showTitleSetup, setShowTitleSetup] = useState(false);
  const [hasSeenTitleSetup, setHasSeenTitleSetup] = useState(false);
  const [dailySwipeCount, setDailySwipeCount] = useState(0);
  const [totalAcceptedCompanies, setTotalAcceptedCompanies] = useState(0);
  const [lastSwipeDate, setLastSwipeDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ quality: 'all', sortBy: 'score' });
  const [lastSwipe, setLastSwipe] = useState(null);
  const [showUndo, setShowUndo] = useState(false);
  const [showSessionOverview, setShowSessionOverview] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');

  // ── People Mode state ───────────────────────────────────────────────────────
  const [mode, setMode] = useState('companies'); // 'companies' | 'people'
  const [peopleQueue, setPeopleQueue] = useState([]);
  const [currentPersonIdx, setCurrentPersonIdx] = useState(0);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [targetTitles, setTargetTitles] = useState([]);
  // 'no_titles' | 'no_contacts' | 'exhausted' | null
  const [peopleModeEmpty, setPeopleModeEmpty] = useState(null);

  // Refs for People Mode fetch management — avoid stale closures
  const companyPoolRef = useRef([]);
  const nextCompanyIdxRef = useRef(0);
  const isFetchingPeopleRef = useRef(false);
  const targetTitlesRef = useRef([]);
  const peopleModeInitRef = useRef(false);
  const todayRef = useRef(new Date().toISOString().split('T')[0]);

  const DAILY_SWIPE_LIMIT = 25;

  useEffect(() => {
    loadTodayLeads();
  }, []);

  // ── Company Mode ────────────────────────────────────────────────────────────

  const loadTodayLeads = async () => {
    try {
      const user = auth.currentUser;
      if (!user) { navigate('/login'); return; }

      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);

      if (!profileDoc.exists()) { setLoading(false); return; }

      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const q = query(companiesRef, where('status', '==', 'pending'));
      const snapshot = await getDocs(q);

      const companiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      companiesData.sort((a, b) => (b.fit_score || 0) - (a.fit_score || 0));
      setCompanies(companiesData);

      const acceptedQuery = query(companiesRef, where('status', '==', 'accepted'));
      const acceptedSnapshot = await getDocs(acceptedQuery);
      setTotalAcceptedCompanies(acceptedSnapshot.size);

      const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
      const swipeProgressDoc = await getDoc(swipeProgressRef);

      if (swipeProgressDoc.exists()) {
        const data = swipeProgressDoc.data();
        const today = new Date().toISOString().split('T')[0];
        if (data.lastSwipeDate === today) {
          setDailySwipeCount(data.dailySwipeCount || 0);
        } else {
          setDailySwipeCount(0);
        }
        setLastSwipeDate(data.lastSwipeDate || '');
        setHasSeenTitleSetup(data.hasSeenTitleSetup || false);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading daily leads:', error);
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    const user = auth.currentUser;
    if (!user || isRefreshing) return;

    setIsRefreshing(true);
    setRefreshMessage('Barry is finding new targets...');

    try {
      const authToken = await user.getIdToken();
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);

      if (!profileDoc.exists()) {
        setRefreshMessage('Set up your ICP first to find targets.');
        setIsRefreshing(false);
        return;
      }

      const response = await fetch('/.netlify/functions/search-companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          companyProfile: profileDoc.data()
        })
      });

      const data = await response.json();

      if (data.success) {
        if (data.companiesAdded > 0) {
          setRefreshMessage(`Found ${data.companiesAdded} new targets.`);
          setTimeout(() => { setRefreshMessage(''); loadTodayLeads(); }, 1500);
        } else if (data.currentQueueSize > 0) {
          setRefreshMessage('Queue is already full. Review your current targets.');
          setTimeout(() => setRefreshMessage(''), 3000);
        } else {
          setRefreshMessage('No new matches found. Try refining your ICP.');
          setTimeout(() => setRefreshMessage(''), 3000);
        }
      } else {
        setRefreshMessage(data.error || 'Refresh failed. Try again.');
        setTimeout(() => setRefreshMessage(''), 3000);
      }
    } catch (error) {
      console.error('Error refreshing leads:', error);
      setRefreshMessage('Refresh failed. Try again.');
      setTimeout(() => setRefreshMessage(''), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSwipe = async (direction) => {
    const user = auth.currentUser;
    if (!user) return;

    const today = new Date().toISOString().split('T')[0];

    if (direction === 'right' && dailySwipeCount >= DAILY_SWIPE_LIMIT && lastSwipeDate === today) {
      alert('Daily hunt limit reached. Time to engage with your catches — select contacts and start outreach.');
      navigate('/scout', { replace: true, state: { activeTab: 'saved-companies' } });
      return;
    }

    const company = companies[currentIndex];

    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
      await updateDoc(companyRef, {
        status: direction === 'right' ? 'accepted' : 'rejected',
        swipedAt: new Date().toISOString(),
        swipeDirection: direction
      });

      const isInterested = direction === 'right';
      const newSwipeCount = isInterested
        ? (lastSwipeDate === today ? dailySwipeCount + 1 : 1)
        : dailySwipeCount;

      const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
      await setDoc(swipeProgressRef, {
        dailySwipeCount: newSwipeCount,
        lastSwipeDate: today,
        hasSeenTitleSetup: hasSeenTitleSetup
      });

      setDailySwipeCount(newSwipeCount);
      setLastSwipeDate(today);

      if (isInterested) setTotalAcceptedCompanies(totalAcceptedCompanies + 1);

      setLastSwipe({ company, direction, index: currentIndex, previousSwipeCount: dailySwipeCount });
      setShowUndo(true);

      const icpProfileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const icpProfileDoc = await getDoc(icpProfileRef);
      const icpTitles = icpProfileDoc.exists() ? icpProfileDoc.data().targetTitles || [] : [];

      if (direction === 'right' && icpTitles.length > 0) {
        const formattedTitles = icpTitles.map((title, index) => ({
          title, rank: index + 1, score: 100 - (index * 10)
        }));
        await updateDoc(companyRef, {
          selected_titles: formattedTitles,
          titles_updated_at: new Date().toISOString(),
          titles_source: 'icp_auto'
        });

        if (company.apollo_organization_id) {
          const authToken = await user.getIdToken();
          fetch('/.netlify/functions/searchPeople', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.uid,
              authToken,
              organizationId: company.apollo_organization_id,
              titles: icpTitles,
              maxResults: 3
            })
          })
          .then(res => res.json())
          .then(async (result) => {
            if (result.success && result.people?.length > 0) {
              for (const person of result.people) {
                const contactId = `${company.id}_${person.id}`;
                const contactRef = doc(db, 'users', user.uid, 'contacts', contactId);
                await setDoc(contactRef, {
                  ...person,
                  company_id: company.id,
                  company_name: company.name,
                  lead_owner: user.uid,
                  status: 'suggested',
                  source: 'icp_auto_discovery',
                  discovered_at: new Date().toISOString()
                });
              }
              await updateDoc(companyRef, {
                auto_contact_status: 'completed',
                auto_contact_count: result.people.length,
                auto_contact_searched_at: new Date().toISOString()
              });
            }
          })
          .catch(err => console.error('Background contact search failed:', err));
        }
      }

      if (direction === 'right' && !hasSeenTitleSetup) {
        const titlePrefsRef = doc(db, 'users', user.uid, 'contactScoring', 'titlePreferences');
        const titlePrefsDoc = await getDoc(titlePrefsRef);
        if (!titlePrefsDoc.exists()) {
          if (icpTitles.length > 0) {
            await setDoc(titlePrefsRef, {
              titles: icpTitles.map((title, index) => ({ title, priority: 50, order: index })),
              updatedAt: new Date().toISOString()
            });
          } else {
            setShowTitleSetup(true);
          }
        }
        setHasSeenTitleSetup(true);
        await setDoc(swipeProgressRef, {
          dailySwipeCount: newSwipeCount,
          lastSwipeDate: today,
          hasSeenTitleSetup: true
        });
      }

      if (currentIndex < companies.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        loadTodayLeads();
      }
    } catch (error) {
      console.error('Error handling swipe:', error);
      alert('Failed to save swipe. Please try again.');
    }
  };

  const handleUndo = async () => {
    if (!lastSwipe) return;
    const user = auth.currentUser;
    if (!user) return;

    const today = new Date().toISOString().split('T')[0];

    try {
      const companyRef = doc(db, 'users', user.uid, 'companies', lastSwipe.company.id);
      await updateDoc(companyRef, {
        status: 'pending', swipedAt: null, swipeDirection: null
      });

      if (lastSwipe.direction === 'right') {
        const swipeProgressRef = doc(db, 'users', user.uid, 'scoutProgress', 'swipes');
        await setDoc(swipeProgressRef, {
          dailySwipeCount: lastSwipe.previousSwipeCount,
          lastSwipeDate: today,
          hasSeenTitleSetup: hasSeenTitleSetup
        });
        setDailySwipeCount(lastSwipe.previousSwipeCount);
        setTotalAcceptedCompanies(totalAcceptedCompanies - 1);

        await updateDoc(companyRef, {
          selected_titles: null,
          titles_updated_at: null,
          titles_source: null,
          auto_contact_status: null,
          auto_contact_count: null,
          auto_contact_searched_at: null
        });

        const autoContactsQuery = query(
          collection(db, 'users', user.uid, 'contacts'),
          where('company_id', '==', lastSwipe.company.id),
          where('source', '==', 'icp_auto_discovery')
        );
        const autoContactDocs = await getDocs(autoContactsQuery);
        for (const contactDoc of autoContactDocs.docs) {
          await deleteDoc(contactDoc.ref);
        }
      }

      setCurrentIndex(lastSwipe.index);
      setLastSwipe(null);
      setShowUndo(false);
    } catch (error) {
      console.error('Error undoing swipe:', error);
      alert('Failed to undo swipe. Please try again.');
    }
  };

  const handleTitleSetupComplete = () => setShowTitleSetup(false);

  // ── People Mode ─────────────────────────────────────────────────────────────

  const handleModeSwitch = async (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    if (newMode === 'people' && !peopleModeInitRef.current) {
      await loadPeopleMode();
    }
  };

  const loadPeopleMode = async () => {
    const user = auth.currentUser;
    if (!user) return;

    setPeopleLoading(true);
    setPeopleModeEmpty(null);

    const today = new Date().toISOString().split('T')[0];
    todayRef.current = today;

    try {
      // Read ICP targetTitles
      const profileRef = doc(db, 'users', user.uid, 'companyProfile', 'current');
      const profileDoc = await getDoc(profileRef);
      const titles = profileDoc.exists() ? (profileDoc.data().targetTitles ?? []) : [];

      if (titles.length === 0) {
        setPeopleModeEmpty('no_titles');
        setPeopleLoading(false);
        return;
      }

      setTargetTitles(titles);
      targetTitlesRef.current = titles;

      // Load all pending + accepted companies as the people pool
      const companiesRef = collection(db, 'users', user.uid, 'companies');
      const companiesSnap = await getDocs(
        query(companiesRef, where('status', 'in', ['pending', 'accepted']))
      );

      const allCompanies = companiesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.apollo_organization_id || c.apollo_id);

      if (allCompanies.length === 0) {
        setPeopleModeEmpty('no_contacts');
        setPeopleLoading(false);
        return;
      }

      companyPoolRef.current = allCompanies;
      nextCompanyIdxRef.current = 0;
      peopleModeInitRef.current = true;

      // Fetch first batch
      await fetchMorePeople(user, titles, today);
    } catch (err) {
      console.error('Error loading People Mode:', err);
      setPeopleModeEmpty('no_contacts');
    } finally {
      setPeopleLoading(false);
    }
  };

  const fetchMorePeople = async (user, titles, today) => {
    if (isFetchingPeopleRef.current) return;
    if (nextCompanyIdxRef.current >= companyPoolRef.current.length) {
      setPeopleQueue(prev => {
        if (prev.length === 0) setPeopleModeEmpty('exhausted');
        return prev;
      });
      return;
    }

    isFetchingPeopleRef.current = true;

    try {
      const authToken = await user.getIdToken();
      const batchSize = 3;
      const startIdx = nextCompanyIdxRef.current;
      const endIdx = Math.min(startIdx + batchSize, companyPoolRef.current.length);
      const newPeople = [];

      for (let i = startIdx; i < endIdx; i++) {
        const company = companyPoolRef.current[i];
        const orgId = company.apollo_organization_id || company.apollo_id;

        try {
          // Batch-load existing contacts for this company to dedup
          const existingSnap = await getDocs(
            query(
              collection(db, 'users', user.uid, 'contacts'),
              where('company_id', '==', company.id)
            )
          );
          const existingByPersonId = {};
          for (const d of existingSnap.docs) {
            const data = d.data();
            if (data.apollo_person_id) existingByPersonId[data.apollo_person_id] = data;
          }

          // Fetch people from Apollo
          const res = await fetch('/.netlify/functions/searchPeople', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.uid,
              authToken,
              organizationId: orgId,
              titles,
              maxResults: 3
            })
          });

          const data = await res.json();

          if (data.success && data.people?.length > 0) {
            for (const person of data.people) {
              const existing = existingByPersonId[person.id];
              if (!existing) {
                // Never seen — add to deck
                newPeople.push({ person, company });
              } else if (
                existing.status === 'people_mode_skipped' &&
                existing.skipped_date !== today
              ) {
                // Skipped on a previous day — return to deck
                newPeople.push({ person, company });
              }
              // Otherwise skip: already matched, archived, or skipped today
            }
          }
        } catch (err) {
          console.error(`Failed to fetch people for ${company.name}:`, err);
        }
      }

      nextCompanyIdxRef.current = endIdx;

      if (newPeople.length > 0) {
        setPeopleQueue(prev => [...prev, ...newPeople]);
      } else if (nextCompanyIdxRef.current >= companyPoolRef.current.length) {
        // All companies processed but no usable people found
        setPeopleQueue(prev => {
          if (prev.length === 0) setPeopleModeEmpty('exhausted');
          return prev;
        });
      } else {
        // Still more companies to try — recurse for next batch
        isFetchingPeopleRef.current = false;
        await fetchMorePeople(user, titles, today);
        return;
      }
    } finally {
      isFetchingPeopleRef.current = false;
    }
  };

  const getBarryText = (person, company, titles) => {
    if (!titles || titles.length === 0) return null;

    const personTitle = (person.title || '').toLowerCase();

    const exactMatch = titles.find(t =>
      personTitle.includes(t.toLowerCase()) || t.toLowerCase().includes(personTitle)
    );
    if (exactMatch) return `Matches your ${exactMatch} target`;

    const keywordMatch = titles.find(t => {
      const words = t.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      return words.some(word => personTitle.includes(word));
    });
    if (keywordMatch) return `Similar role to your ${keywordMatch} target`;

    return 'Title match — outside your target industry.';
  };

  const handlePersonSwipe = async (direction) => {
    const user = auth.currentUser;
    if (!user) return;

    const today = todayRef.current;
    const personItem = peopleQueue[currentPersonIdx];
    if (!personItem) return;

    const { person, company } = personItem;
    const contactId = `${company.id}_${person.id}`;
    const contactRef = doc(db, 'users', user.uid, 'contacts', contactId);

    try {
      if (direction === 'right') {
        // Match: save contact into engage queue
        await setDoc(contactRef, {
          ...person,
          apollo_person_id: person.id,
          company_id: company.id,
          company_name: company.name,
          lead_owner: user.uid,
          status: 'suggested',
          source: 'people_mode',
          saved_at: new Date().toISOString()
        }, { merge: true });

        // Save company if it's still pending
        if (company.status === 'pending') {
          const companyRef = doc(db, 'users', user.uid, 'companies', company.id);
          await updateDoc(companyRef, {
            status: 'accepted',
            swipedAt: new Date().toISOString(),
            swipeDirection: 'right',
            swipe_source: 'people_mode'
          });
          if (targetTitlesRef.current.length > 0) {
            const formattedTitles = targetTitlesRef.current.map((title, idx) => ({
              title, rank: idx + 1, score: 100 - (idx * 10)
            }));
            await updateDoc(companyRef, {
              selected_titles: formattedTitles,
              titles_updated_at: new Date().toISOString(),
              titles_source: 'icp_auto'
            });
          }
        }
      } else if (direction === 'left') {
        // Not a Match: archive — never show again
        await setDoc(contactRef, {
          apollo_person_id: person.id,
          company_id: company.id,
          status: 'people_mode_archived',
          source: 'people_mode',
          archived_at: new Date().toISOString()
        }, { merge: true });
      } else if (direction === 'skip') {
        // Skip for Today: return tomorrow
        await setDoc(contactRef, {
          apollo_person_id: person.id,
          company_id: company.id,
          status: 'people_mode_skipped',
          source: 'people_mode',
          skipped_date: today
        }, { merge: true });
      }

      const nextIdx = currentPersonIdx + 1;
      const remaining = peopleQueue.length - nextIdx;

      // Pre-fetch next batch when queue is running low
      if (remaining < 5) {
        const activeUser = auth.currentUser;
        if (activeUser) fetchMorePeople(activeUser, targetTitlesRef.current, today);
      }

      setCurrentPersonIdx(nextIdx);

      // If we've run out, check if more are coming
      if (nextIdx >= peopleQueue.length && nextCompanyIdxRef.current >= companyPoolRef.current.length) {
        setPeopleModeEmpty('exhausted');
      }
    } catch (err) {
      console.error('Error handling person swipe:', err);
      alert('Failed to save. Please try again.');
    }
  };

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const getNextRefreshInfo = () => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();
    let daysUntilRefresh = 0;
    if (dayOfWeek === 0) daysUntilRefresh = 1;
    else if (dayOfWeek === 6) daysUntilRefresh = 2;
    else if (dayOfWeek === 5 && hour >= 9) daysUntilRefresh = 3;
    else if (hour >= 9) daysUntilRefresh = 1;
    if (daysUntilRefresh === 0) return 'New targets arriving at 9am UTC (4am ET)';
    if (daysUntilRefresh === 1) return 'New targets arriving tomorrow at 9am UTC';
    return 'New targets arriving Monday at 9am UTC';
  };

  // ── KPIs (Company Mode) ─────────────────────────────────────────────────────
  const matchRate = companies.length > 0
    ? Math.round((dailySwipeCount / (currentIndex + 1)) * 100) || 0
    : 0;
  const remainingLeads = companies.length - currentIndex;

  // ── Render: initial load ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="daily-leads-loading">
        <div className="loading-spinner"></div>
        <p className="loading-text">Loading lead insights...</p>
      </div>
    );
  }

  // ── Render: Company Mode empty ──────────────────────────────────────────────
  if (mode === 'companies' && companies.length === 0) {
    return (
      <div className="daily-leads">
        <div className="discovery-header">
          <h1 className="discovery-title">Today's Targets</h1>
          <p className="discovery-subtitle">AI-curated prospects matching your ICP</p>
          <div className="mode-toggle">
            <button
              className={`mode-toggle-btn ${mode === 'companies' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('companies')}
            >
              Companies
            </button>
            <button
              className={`mode-toggle-btn ${mode === 'people' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('people')}
            >
              People
            </button>
          </div>
        </div>

        <div className="empty-daily-leads">
          <div className="empty-icon">
            <Target className="w-16 h-16 text-gray-400" />
          </div>
          <h2>Hunt Complete</h2>
          <p>You've reviewed all available targets. Your saved companies are ready for outreach.</p>

          {refreshMessage && (
            <div className="refresh-status">
              {isRefreshing && <Loader className="w-4 h-4 animate-spin" />}
              <span>{refreshMessage}</span>
            </div>
          )}
          {!refreshMessage && <p className="empty-hint">{getNextRefreshInfo()}</p>}

          <div className="empty-actions">
            <button onClick={handleManualRefresh} disabled={isRefreshing} className="primary-btn refresh-btn">
              {isRefreshing ? (
                <><Loader className="w-4 h-4 animate-spin" /><span>Finding targets...</span></>
              ) : (
                <><RefreshCw className="w-4 h-4" /><span>Refresh Leads Now</span></>
              )}
            </button>
            <button
              onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
              className="secondary-btn"
            >
              View Saved Companies
            </button>
          </div>
          <button
            onClick={() => navigate('/scout', { state: { activeTab: 'icp-settings' } })}
            className="tertiary-btn"
          >
            Refine Targets
          </button>
        </div>
      </div>
    );
  }

  const currentCompany = companies[currentIndex];
  const currentPersonItem = peopleQueue[currentPersonIdx];
  const currentPerson = currentPersonItem?.person;
  const currentPersonCompany = currentPersonItem?.company;

  // ── Render: People Mode loading ─────────────────────────────────────────────
  const renderPeopleModeContent = () => {
    if (peopleLoading) {
      return (
        <div className="people-mode-loading">
          <div className="loading-spinner"></div>
          <p className="loading-text">Barry is finding people for you...</p>
        </div>
      );
    }

    if (peopleModeEmpty === 'no_titles') {
      return (
        <div className="empty-daily-leads">
          <div className="empty-icon">
            <Users className="w-16 h-16 text-gray-400" />
          </div>
          <h2>Set Up Your Target Titles</h2>
          <p>Add your target titles in ICP Settings so Barry knows who to find.</p>
          <div className="empty-actions">
            <button
              onClick={() => navigate('/scout', { state: { activeTab: 'icp-settings' } })}
              className="primary-btn"
            >
              <Settings className="w-4 h-4" />
              <span>Go to ICP Settings</span>
            </button>
          </div>
        </div>
      );
    }

    if (peopleModeEmpty === 'no_contacts' && (!currentPerson)) {
      return (
        <div className="empty-daily-leads">
          <div className="empty-icon">
            <Users className="w-16 h-16 text-gray-400" />
          </div>
          <h2>No Matches Found Today</h2>
          <p>No matches found today. Barry will keep looking.</p>
          <div className="empty-actions">
            <button
              onClick={() => navigate('/scout', { state: { activeTab: 'icp-settings' } })}
              className="secondary-btn"
            >
              Refine ICP Settings
            </button>
          </div>
        </div>
      );
    }

    if (!currentPerson) {
      // Queue is exhausted or still loading more — check if we might get more
      if (peopleModeEmpty === 'exhausted' || nextCompanyIdxRef.current >= companyPoolRef.current.length) {
        return (
          <div className="empty-daily-leads">
            <div className="empty-icon">
              <CheckCircle className="w-16 h-16 text-green-400" />
            </div>
            <h2>All Caught Up</h2>
            <p>You've reviewed everyone for today. Check back tomorrow.</p>
            <div className="empty-actions">
              <button
                onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
                className="secondary-btn"
              >
                View Saved Companies
              </button>
            </div>
          </div>
        );
      }
      // Still fetching — show a brief spinner
      return (
        <div className="people-mode-loading">
          <div className="loading-spinner"></div>
          <p className="loading-text">Loading more people...</p>
        </div>
      );
    }

    const barryText = getBarryText(currentPerson, currentPersonCompany, targetTitles);
    const totalInQueue = peopleQueue.length;

    return (
      <>
        {/* Progress */}
        <div className="progress-dots">
          {peopleQueue.slice(currentPersonIdx, Math.min(currentPersonIdx + 7, totalInQueue)).map((_, i) => (
            <div
              key={i}
              className={`progress-dot ${i === 0 ? 'active' : ''}`}
            />
          ))}
        </div>
        <div className="progress-count">
          {currentPersonIdx + 1} of {totalInQueue}
          {nextCompanyIdxRef.current < companyPoolRef.current.length && '+'}
        </div>

        {/* Person Card */}
        <div className="swipe-card-hero">
          <PersonCard
            person={currentPerson}
            company={currentPersonCompany}
            onSwipe={handlePersonSwipe}
            barryText={barryText}
          />
        </div>

        {/* People Mode Microcopy */}
        <div className="swipe-microcopy">
          <div className="microcopy-item reject-hint">
            <span className="microcopy-icon">👈</span>
            <span className="microcopy-text">Not this person</span>
          </div>
          <div className="microcopy-item accept-hint">
            <span className="microcopy-text">Save to engage</span>
            <span className="microcopy-icon">👉</span>
          </div>
        </div>
      </>
    );
  };

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="daily-leads">
      {/* Discovery Header */}
      <div className="discovery-header">
        <h1 className="discovery-title">Today's Targets</h1>
        <p className="discovery-subtitle">AI-curated prospects matching your ICP</p>

        {/* Mode Toggle */}
        <div className="mode-toggle">
          <button
            className={`mode-toggle-btn ${mode === 'companies' ? 'active' : ''}`}
            onClick={() => handleModeSwitch('companies')}
          >
            Companies
          </button>
          <button
            className={`mode-toggle-btn ${mode === 'people' ? 'active' : ''}`}
            onClick={() => handleModeSwitch('people')}
          >
            People
          </button>
        </div>
      </div>

      {/* ── Company Mode ── */}
      {mode === 'companies' && (
        <>
          {/* Compact Filters Button */}
          <button
            className="filters-compact-btn"
            onClick={() => setShowFilters(!showFilters)}
            title="Filters & Sort"
          >
            <Filter size={18} />
            {showFilters ? <span>Close</span> : <span>Filters</span>}
          </button>

          {showFilters && (
            <div className="filters-panel">
              <div className="filter-group">
                <label>Lead Quality</label>
                <select value={filters.quality} onChange={(e) => setFilters({ ...filters, quality: e.target.value })}>
                  <option value="all">All Leads</option>
                  <option value="high">High Quality (80+)</option>
                  <option value="medium">Medium Quality (50-79)</option>
                  <option value="low">Needs Review (&lt;50)</option>
                </select>
              </div>
              <div className="filter-group">
                <label>Sort By</label>
                <select value={filters.sortBy} onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}>
                  <option value="score">Lead Score (High to Low)</option>
                  <option value="recent">Recently Added</option>
                  <option value="revenue">Revenue (High to Low)</option>
                </select>
              </div>
            </div>
          )}

          {/* Progress Dots */}
          <div className="progress-dots">
            {companies.slice(0, Math.min(companies.length, 7)).map((_, index) => (
              <div
                key={index}
                className={`progress-dot ${index === currentIndex ? 'active' : ''} ${index < currentIndex ? 'completed' : ''}`}
              />
            ))}
            {companies.length > 7 && <span className="progress-more">+{companies.length - 7}</span>}
          </div>
          <div className="progress-count">{currentIndex + 1} of {companies.length}</div>

          {/* Company Card */}
          {currentCompany && (
            <div className="swipe-card-hero">
              <CompanyCard company={currentCompany} onSwipe={handleSwipe} />
            </div>
          )}

          {/* Undo */}
          {showUndo && lastSwipe && (
            <div className="undo-container">
              <button className="undo-btn" onClick={handleUndo}>
                <RotateCcw className="w-5 h-5" />
                <span>Undo</span>
              </button>
            </div>
          )}

          {/* Microcopy */}
          <div className="swipe-microcopy">
            <div className="microcopy-item reject-hint">
              <span className="microcopy-icon">👈</span>
              <span className="microcopy-text">Sharpens your targeting</span>
            </div>
            <div className="microcopy-item accept-hint">
              <span className="microcopy-text">Add to your hunt list</span>
              <span className="microcopy-icon">👉</span>
            </div>
          </div>

          {/* Session Overview */}
          <div className="session-overview-wrapper">
            <button
              className="session-overview-toggle"
              onClick={() => setShowSessionOverview(!showSessionOverview)}
            >
              <span>Session Overview</span>
              <ChevronDown className={`toggle-icon ${showSessionOverview ? 'rotated' : ''}`} size={18} />
            </button>
            {showSessionOverview && (
              <div className="session-stats">
                <div className="session-stat">
                  <div className="stat-label">Targets Left</div>
                  <div className="stat-value">{remainingLeads}</div>
                </div>
                <div className="session-stat primary">
                  <div className="stat-label">Today's Catches</div>
                  <div className="stat-value">{dailySwipeCount} <span className="stat-max">/ {DAILY_SWIPE_LIMIT}</span></div>
                </div>
                <div className="session-stat">
                  <div className="stat-label">Total Hunt List</div>
                  <div className="stat-value">{totalAcceptedCompanies}</div>
                </div>
              </div>
            )}
          </div>

          {dailySwipeCount > 0 && (
            <div className="action-footer">
              <button
                className="view-saved-companies-btn"
                onClick={() => navigate('/scout', { state: { activeTab: 'saved-companies' } })}
              >
                <CheckCircle className="w-5 h-5" />
                <span>View Saved Companies ({dailySwipeCount})</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* ── People Mode ── */}
      {mode === 'people' && renderPeopleModeContent()}

      {/* Contact Title Setup Modal */}
      {showTitleSetup && <ContactTitleSetup onComplete={handleTitleSetupComplete} />}
    </div>
  );
}
