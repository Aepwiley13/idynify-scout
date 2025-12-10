import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function Phase3SmartContacts({ phase2Data, scoutData, onComplete }) {
  const navigate = useNavigate();
  const [currentCompanyIndex, setCurrentCompanyIndex] = useState(0);
  const [suggestedContacts, setSuggestedContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [allSelections, setAllSelections] = useState({}); // { companyId: { accepted: [], rejected: [] } }
  const [seenContactIds, setSeenContactIds] = useState([]); // Track all shown contacts
  const [error, setError] = useState(null);

  const companies = phase2Data.selectedCompanies || [];
  const currentCompany = companies[currentCompanyIndex];

  useEffect(() => {
    if (currentCompany) {
      loadContactsForCompany(currentCompany);
    }
  }, [currentCompanyIndex]);

  const loadContactsForCompany = async (company, refresh = false) => {
    try {
      setLoadingContacts(true);
      setError(null);

      const response = await fetch('/.netlify/functions/barry-phase3-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          company: company,
          scoutData: scoutData,
          excludeContactIds: refresh ? seenContactIds : []
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load contacts');
      }

      console.log('✅ Barry suggestions:', data);
      
      if (refresh) {
        // Append new contacts
        setSuggestedContacts([...suggestedContacts, ...data.contacts]);
      } else {
        // Initial load
        setSuggestedContacts(data.contacts);
      }

      // Track seen contact IDs
      const newIds = data.contacts.map(c => c.id);
      setSeenContactIds([...seenContactIds, ...newIds]);

      setLoadingContacts(false);

    } catch (err) {
      console.error('❌ Error loading contacts:', err);
      setError(err.message);
      setLoadingContacts(false);
    }
  };

  const handleContactAction = async (contact, action) => {
    const companyId = currentCompany.id || currentCompany.name;
    
    // Update selections
    setAllSelections(prev => {
      const companySelections = prev[companyId] || { accepted: [], rejected: [] };
      
      if (action === 'accept') {
        return {
          ...prev,
          [companyId]: {
            ...companySelections,
            accepted: [...companySelections.accepted, contact]
          }
        };
      } else {
        return {
          ...prev,
          [companyId]: {
            ...companySelections,
            rejected: [...companySelections.rejected, contact]
          }
        };
      }
    });

    // Save progress
    await saveProgress();
  };

  const handleShowMore = () => {
    loadContactsForCompany(currentCompany, true); // refresh = true
  };

  const handleNextCompany = async () => {
    if (currentCompanyIndex < companies.length - 1) {
      setCurrentCompanyIndex(currentCompanyIndex + 1);
      setSuggestedContacts([]);
      setSeenContactIds([]);
    } else {
      // All companies reviewed
      await completePhase3();
    }
  };

  const saveProgress = async () => {
    try {
      const user = auth.currentUser;
      await setDoc(doc(db, 'missions', user.uid, 'current', 'phase3'), {
        allSelections: allSelections,
        currentCompanyIndex: currentCompanyIndex,
        companies: companies,
        progress: {
          currentCompany: currentCompanyIndex + 1,
          totalCompanies: companies.length,
          percentComplete: Math.round(((currentCompanyIndex + 1) / companies.length) * 100)
        },
        lastUpdated: serverTimestamp()
      }, { merge: true });
      
      console.log(`💾 Progress saved: Company ${currentCompanyIndex + 1}/${companies.length}`);
    } catch (err) {
      console.error('Error saving progress:', err);
    }
  };

  const completePhase3 = async () => {
    try {
      const user = auth.currentUser;
      
      // Use setDoc with merge to create or update
      await setDoc(doc(db, 'missions', user.uid, 'current', 'phase3'), {
        completedAt: serverTimestamp(),
        progress: {
          percentComplete: 100
        }
      }, { merge: true });

      // Flatten all accepted contacts
      const allAcceptedContacts = [];
      Object.values(allSelections).forEach(selection => {
        allAcceptedContacts.push(...selection.accepted);
      });

      console.log('✅ Phase 3 complete:', allAcceptedContacts.length, 'contacts selected');

      onComplete({
        selectedContacts: allAcceptedContacts,
        selectionsByCompany: allSelections
      });
    } catch (err) {
      console.error('Error completing Phase 3:', err);
    }
  };

  const getCompanySelections = () => {
    const companyId = currentCompany?.id || currentCompany?.name;
    return allSelections[companyId] || { accepted: [], rejected: [] };
  };

  // Space background component
  const SpaceBackground = () => (
    <>
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(200)].map((_, i) => (
          <div
            key={i}
            className="absolute bg-white rounded-full"
            style={{
              width: Math.random() * 2 + 1 + 'px',
              height: Math.random() * 2 + 1 + 'px',
              top: Math.random() * 100 + '%',
              left: Math.random() * 100 + '%',
              opacity: Math.random() * 0.7 + 0.3,
              animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`
            }}
          />
        ))}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-cyan-900/20 to-transparent">
        <svg className="w-full h-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="cyan" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />
        </svg>
      </div>
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes floatCode {
          0% { transform: translateY(100vh) translateX(0); }
          100% { transform: translateY(-100vh) translateX(50px); }
        }
      `}</style>
    </>
  );

  const FloatingCode = ({ codes }) => (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {codes.map((code, i) => (
        <div
          key={i}
          className="absolute text-cyan-400/30 font-mono text-sm"
          style={{
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
            animation: `floatCode ${15 + i * 3}s linear infinite`,
            animationDelay: `${i * 2}s`
          }}
        >
          {code}
        </div>
      ))}
    </div>
  );

  if (error) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[ERROR]', '[BARRY:STANDBY]']} />
        
        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="border-4 border-red-400 bg-black/90 backdrop-blur-sm p-12 max-w-3xl w-full">
            <div className="text-center mb-10">
              <div className="text-9xl mb-8">✗</div>
              <h2 className="text-5xl font-bold text-red-400 mb-6 font-mono">[ ERROR ]</h2>
            </div>
            <div className="border border-red-400/30 bg-black p-8 mb-10">
              <p className="text-red-200 font-mono text-xl">{error}</p>
            </div>
            <button
              onClick={() => loadContactsForCompany(currentCompany)}
              className="w-full py-6 bg-red-600 text-white text-2xl font-bold font-mono hover:bg-red-500 transition-all"
            >
              [ RETRY ] →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentCompany) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;
  }

  const selections = getCompanySelections();
  const progress = ((currentCompanyIndex + 1) / companies.length) * 100;

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      <SpaceBackground />
      <FloatingCode codes={['[BARRY:ANALYZING]', '[CONTACTS:SUGGESTING]', '[INTELLIGENCE:ACTIVE]', '[MISSION:PHASE3]', '[LEARNING:ENABLED]']} />

      <div className="relative z-10 py-12 px-6">
        <div className="max-w-7xl mx-auto">
          
          {/* Progress Header */}
          <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm p-10 mb-10">
            <div className="text-center mb-8">
              <div className="text-lg text-cyan-400 mb-3 font-mono tracking-widest">PHASE 3: SMART CONTACT DISCOVERY</div>
              <h1 className="text-6xl font-bold text-cyan-400 mb-6 font-mono">
                [ COMPANY {currentCompanyIndex + 1} OF {companies.length} ]
              </h1>
              <div className="w-full bg-gray-800 h-4 border border-cyan-400/30 mb-4">
                <div 
                  className="bg-gradient-to-r from-cyan-400 to-purple-400 h-full transition-all"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <div className="text-gray-400 font-mono text-lg">
                {selections.accepted.length} selected • {selections.rejected.length} passed
              </div>
            </div>
          </div>

          {/* Current Company Card */}
          <div className="border-4 border-purple-400 bg-black/90 backdrop-blur-sm p-10 mb-10">
            <div className="flex items-center justify-between mb-6">
              <div className="flex-1">
                <h2 className="text-5xl font-bold text-white font-mono mb-3">{currentCompany.name}</h2>
                <div className="flex gap-6 text-xl font-mono">
                  <span className="text-cyan-400">🏢 {currentCompany.estimated_num_employees || '?'} employees</span>
                  <span className="text-purple-400">📊 {currentCompany.industry || 'Unknown'}</span>
                </div>
              </div>
              {currentCompany.barryScore && (
                <div className="text-right">
                  <div className="text-sm text-gray-400 font-mono mb-2">BARRY SCORE</div>
                  <div className="text-6xl font-bold text-purple-400 font-mono">{currentCompany.barryScore}</div>
                </div>
              )}
            </div>
          </div>

          {/* Barry's Suggestions */}
          <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-10 mb-6">
            <div className="flex items-center gap-4 mb-8 pb-6 border-b border-cyan-400/30">
              <span className="text-5xl">🧠</span>
              <div>
                <h3 className="text-cyan-400 font-bold font-mono text-3xl">BARRY'S SMART SUGGESTIONS</h3>
                <p className="text-cyan-300 font-mono text-lg mt-2">
                  {loadingContacts ? 'Analyzing...' : `${suggestedContacts.length} contacts suggested`}
                </p>
              </div>
            </div>

            {loadingContacts && suggestedContacts.length === 0 ? (
              <div className="text-center py-20">
                <div className="inline-block animate-pulse mb-8">
                  <div className="flex gap-3">
                    <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-5 h-5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
                <p className="text-cyan-400 text-2xl font-mono">Barry is analyzing contacts...</p>
              </div>
            ) : suggestedContacts.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-8xl mb-6">⚠️</div>
                <h3 className="text-yellow-400 font-bold font-mono text-3xl mb-4">NO CONTACTS FOUND</h3>
                <p className="text-yellow-200 font-mono text-xl mb-8">
                  Barry couldn't find any contacts in this company
                </p>
                <button
                  onClick={handleNextCompany}
                  className="px-8 py-4 bg-yellow-600 text-white text-xl font-bold font-mono hover:bg-yellow-500 transition-all"
                >
                  {currentCompanyIndex < companies.length - 1 ? 'SKIP TO NEXT COMPANY →' : 'COMPLETE PHASE 3 →'}
                </button>
              </div>
            ) : (
              <>
                {/* Contact Grid */}
                <div className="grid md:grid-cols-2 gap-6 mb-8">
                  {suggestedContacts.map((contact, idx) => (
                    <ContactCard
                      key={contact.id}
                      contact={contact}
                      onAccept={() => handleContactAction(contact, 'accept')}
                      onReject={() => handleContactAction(contact, 'reject')}
                      isAccepted={selections.accepted.some(c => c.id === contact.id)}
                      isRejected={selections.rejected.some(c => c.id === contact.id)}
                    />
                  ))}
                </div>

                {/* Show More Button */}
                <div className="flex gap-4">
                  <button
                    onClick={handleShowMore}
                    disabled={loadingContacts}
                    className="flex-1 py-6 bg-gray-700 text-white text-xl font-bold font-mono hover:bg-gray-600 transition-all border-2 border-gray-600 disabled:opacity-50"
                  >
                    {loadingContacts ? 'LOADING...' : '🔄 SHOW 5 MORE CONTACTS'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Next Company Button */}
          {suggestedContacts.length > 0 && (
            <button
              onClick={handleNextCompany}
              className="w-full py-8 bg-green-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600 shadow-lg shadow-green-400/50"
            >
              {currentCompanyIndex < companies.length - 1 ? '[ NEXT COMPANY ] →' : '[ COMPLETE PHASE 3 ] →'}
            </button>
          )}

        </div>
      </div>
    </div>
  );
}

// Contact Card Component
function ContactCard({ contact, onAccept, onReject, isAccepted, isRejected }) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className={`border-2 bg-black/50 p-6 transition-all ${
      isAccepted ? 'border-green-400 bg-green-900/20' :
      isRejected ? 'border-red-400 bg-red-900/20' :
      'border-purple-400/30 hover:border-purple-400'
    }`}>
      {/* Header */}
      <div className="flex items-start gap-4 mb-4">
        {contact.photoUrl ? (
          <div className="w-16 h-16 border-2 border-purple-400 bg-gray-900 flex-shrink-0 overflow-hidden">
            <img 
              src={contact.photoUrl} 
              alt={contact.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.parentElement.innerHTML = '<div class="w-full h-full flex items-center justify-center text-3xl">👤</div>';
              }}
            />
          </div>
        ) : (
          <div className="w-16 h-16 border-2 border-purple-400 bg-gray-900 flex items-center justify-center flex-shrink-0">
            <div className="text-3xl">👤</div>
          </div>
        )}

        <div className="flex-1">
          <h4 className="text-white font-bold font-mono text-xl mb-1">{contact.name}</h4>
          <div className="text-purple-300 font-mono text-sm mb-2">{contact.title}</div>
          {contact.seniority && (
            <div className="inline-block border border-purple-400/50 bg-purple-900/20 px-2 py-1">
              <div className="text-purple-300 font-mono text-xs">{contact.seniority.toUpperCase()}</div>
            </div>
          )}
        </div>
      </div>

      {/* Barry's Reason */}
      {contact.barryReason && (
        <div className="border border-cyan-400/30 bg-cyan-900/10 p-4 mb-4">
          <div className="text-xs text-cyan-400 font-mono mb-2">🧠 BARRY'S INSIGHT:</div>
          <p className="text-cyan-200 font-mono text-sm">{contact.barryReason}</p>
        </div>
      )}

      {/* Contact Info */}
      <div className="space-y-2 mb-4">
        {contact.email && (
          <div className="text-gray-300 font-mono text-sm flex items-center gap-2">
            <span>📧</span>
            <span className="truncate">{contact.email}</span>
            {contact.emailStatus === 'verified' && <span className="text-green-400 text-xs">(✓)</span>}
          </div>
        )}
        {contact.linkedinUrl && (
          <div className="text-gray-300 font-mono text-sm flex items-center gap-2">
            <span>💼</span>
            <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
              LinkedIn Profile ↗
            </a>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {!isAccepted && !isRejected ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={onReject}
            className="py-3 bg-red-600 text-white text-sm font-bold font-mono hover:bg-red-500 transition-all"
          >
            ✗ PASS
          </button>
          <button
            onClick={onAccept}
            className="py-3 bg-green-600 text-white text-sm font-bold font-mono hover:bg-green-500 transition-all"
          >
            ✓ SELECT
          </button>
        </div>
      ) : (
        <div className={`text-center py-3 font-mono text-lg font-bold ${
          isAccepted ? 'text-green-400' : 'text-red-400'
        }`}>
          {isAccepted ? '✓ SELECTED' : '✗ PASSED'}
        </div>
      )}
    </div>
  );
}