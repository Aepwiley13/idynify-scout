import { useState, useEffect } from 'react';
import { auth, db } from '../firebase/config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function Phase3MissionContacts({ phase2Data, scoutData, onComplete }) {
  const [stage, setStage] = useState('briefing'); // briefing, loading, review, summary, complete
  const [currentCompanyIndex, setCurrentCompanyIndex] = useState(0);
  const [contacts, setContacts] = useState([]);
  const [currentContactIndex, setCurrentContactIndex] = useState(0);
  const [allSelections, setAllSelections] = useState({}); // { companyId: { accepted: [], rejected: [] } }
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const companies = phase2Data.selectedCompanies || [];
  const currentCompany = companies[currentCompanyIndex];
  const totalCompanies = companies.length;

  // Start with briefing for first company
  useEffect(() => {
    if (currentCompany) {
      setStage('briefing');
    }
  }, [currentCompanyIndex]);

  const handleInitiateScan = async () => {
    try {
      setStage('loading');
      setProgress(0);
      setError(null);

      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + Math.random() * 15, 95));
      }, 500);

      console.log('🎯 Scanning company:', currentCompany.name);

      const response = await fetch('/.netlify/functions/barry-phase3-people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: auth.currentUser.uid,
          selectedCompanies: [currentCompany], // Send ONE company at a time
          targetTitles: scoutData.jobTitles || scoutData.targetTitles || []
        })
      });

      clearInterval(progressInterval);
      setProgress(100);

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to find contacts');
      }

      console.log('✅ Found contacts:', data.people?.length || 0);
      
      if (!data.people || data.people.length === 0) {
        // No contacts found - skip to next company
        handleNoContacts();
        return;
      }

      setContacts(data.people);
      setCurrentContactIndex(0);
      
      setTimeout(() => {
        setStage('review');
      }, 800);

    } catch (err) {
      console.error('❌ Error scanning company:', err);
      setError(err.message);
      setStage('briefing');
    }
  };

  const handleNoContacts = () => {
    // Save empty selection for this company
    const companyId = currentCompany.id || currentCompany.name;
    setAllSelections(prev => ({
      ...prev,
      [companyId]: { accepted: [], rejected: [] }
    }));

    // Move to next company or complete
    if (currentCompanyIndex < totalCompanies - 1) {
      setCurrentCompanyIndex(currentCompanyIndex + 1);
    } else {
      completePhase3();
    }
  };

  const handleContactAction = async (action) => {
    const currentContact = contacts[currentContactIndex];
    const companyId = currentCompany.id || currentCompany.name;
    
    // Update selections
    setAllSelections(prev => {
      const companySelections = prev[companyId] || { accepted: [], rejected: [] };
      
      if (action === 'accept') {
        return {
          ...prev,
          [companyId]: {
            ...companySelections,
            accepted: [...companySelections.accepted, currentContact]
          }
        };
      } else {
        return {
          ...prev,
          [companyId]: {
            ...companySelections,
            rejected: [...companySelections.rejected, currentContact]
          }
        };
      }
    });

    // Move to next contact or show summary
    if (currentContactIndex < contacts.length - 1) {
      setCurrentContactIndex(currentContactIndex + 1);
    } else {
      // Finished reviewing all contacts for this company
      showCompanySummary();
    }
  };

  const showCompanySummary = async () => {
    setStage('summary');
    await saveProgress();
  };

  const handleNextCompany = () => {
    if (currentCompanyIndex < totalCompanies - 1) {
      setCurrentCompanyIndex(currentCompanyIndex + 1);
      setContacts([]);
      setCurrentContactIndex(0);
    } else {
      completePhase3();
    }
  };

  const saveProgress = async () => {
    try {
      const user = auth.currentUser;
      await setDoc(doc(db, 'missions', user.uid, 'current', 'phase3'), {
        allSelections: allSelections,
        currentCompanyIndex: currentCompanyIndex,
        progress: {
          currentCompany: currentCompanyIndex + 1,
          totalCompanies: totalCompanies,
          percentComplete: Math.round(((currentCompanyIndex + 1) / totalCompanies) * 100)
        },
        lastUpdated: serverTimestamp()
      }, { merge: true });
      
      console.log(`💾 Progress saved: ${currentCompanyIndex + 1}/${totalCompanies}`);
    } catch (err) {
      console.error('Error saving progress:', err);
    }
  };

  const completePhase3 = async () => {
    try {
      setStage('complete');
      const user = auth.currentUser;
      
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

      // Brief pause then callback
      setTimeout(() => {
        onComplete({
          selectedPeople: allAcceptedContacts,
          allSelections: allSelections
        });
      }, 2000);

    } catch (err) {
      console.error('Error completing Phase 3:', err);
    }
  };

  // Shared Components
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
      <style>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </>
  );

  // BRIEFING STAGE - Company introduction
  if (stage === 'briefing') {
    const companySelections = allSelections[currentCompany.id || currentCompany.name] || { accepted: [], rejected: [] };
    
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-4xl mx-auto">
            {/* Progress Bar */}
            <div className="mb-8">
              <div className="flex justify-between items-center mb-2">
                <span className="text-cyan-400 font-mono text-sm">MISSION PROGRESS</span>
                <span className="text-cyan-400 font-mono text-sm">{currentCompanyIndex + 1} / {totalCompanies}</span>
              </div>
              <div className="h-2 bg-gray-800 border border-cyan-400/30">
                <div 
                  className="h-full bg-cyan-400 transition-all duration-500"
                  style={{ width: `${((currentCompanyIndex) / totalCompanies) * 100}%` }}
                ></div>
              </div>
            </div>

            {/* Target Briefing */}
            <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm p-12 mb-8">
              <div className="text-center mb-10">
                <div className="text-base text-cyan-400 font-mono tracking-widest mb-4">TARGET BRIEFING</div>
                <h1 className="text-6xl font-bold text-cyan-400 mb-6 font-mono">
                  [ {currentCompany.name} ]
                </h1>
                <div className="inline-block border-2 border-cyan-400 bg-cyan-900/20 px-8 py-4">
                  <div className="text-xl text-cyan-400 font-mono">TARGET {currentCompanyIndex + 1} OF {totalCompanies}</div>
                </div>
              </div>

              {/* Company Profile */}
              <div className="grid md:grid-cols-2 gap-6 mb-10">
                <div className="border border-cyan-400/30 bg-black/50 p-6">
                  <div className="text-sm text-cyan-400 font-mono mb-2">BARRY SCORE</div>
                  <div className="text-4xl font-bold text-green-400 font-mono">
                    {currentCompany.barryScore || 'N/A'}
                  </div>
                </div>
                <div className="border border-cyan-400/30 bg-black/50 p-6">
                  <div className="text-sm text-cyan-400 font-mono mb-2">EMPLOYEES</div>
                  <div className="text-4xl font-bold text-white font-mono">
                    {currentCompany.estimated_num_employees || 'Unknown'}
                  </div>
                </div>
              </div>

              {/* Company Details */}
              <div className="space-y-4 mb-10">
                {currentCompany.industry && (
                  <div className="border border-cyan-400/30 bg-black/50 p-4">
                    <div className="text-sm text-cyan-400 font-mono mb-1">INDUSTRY</div>
                    <div className="text-lg text-white font-mono">{currentCompany.industry}</div>
                  </div>
                )}
                {currentCompany.website_url && (
                  <div className="border border-cyan-400/30 bg-black/50 p-4">
                    <div className="text-sm text-cyan-400 font-mono mb-1">DOMAIN</div>
                    <a 
                      href={currentCompany.website_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-lg text-blue-400 hover:text-blue-300 font-mono underline"
                    >
                      {currentCompany.website_url}
                    </a>
                  </div>
                )}
                {currentCompany.barryReason && (
                  <div className="border border-yellow-400/30 bg-yellow-900/10 p-4">
                    <div className="text-sm text-yellow-400 font-mono mb-1">MATCH REASON</div>
                    <div className="text-base text-yellow-200 font-mono">{currentCompany.barryReason}</div>
                  </div>
                )}
              </div>

              {error && (
                <div className="border-2 border-red-400 bg-red-900/20 p-6 mb-6">
                  <div className="text-red-200 font-mono text-center">{error}</div>
                </div>
              )}

              <button
                onClick={handleInitiateScan}
                className="w-full py-8 bg-cyan-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-cyan-300 transition-all border-4 border-cyan-600 shadow-lg shadow-cyan-400/50"
              >
                [ INITIATE CONTACT SCAN ] →
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // LOADING STAGE
  if (stage === 'loading') {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />

        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm p-16 max-w-3xl w-full">
            <div className="text-center">
              <div className="text-8xl mb-8 animate-pulse">🔍</div>
              <h2 className="text-5xl font-bold text-cyan-400 mb-8 font-mono">[ SCANNING ]</h2>
              
              <div className="mb-8">
                <div className="text-2xl text-cyan-300 font-mono mb-4">
                  Analyzing: {currentCompany.name}
                </div>
                <div className="text-lg text-gray-400 font-mono space-y-2">
                  <div className="animate-pulse">▸ Scanning organization chart...</div>
                  <div className="animate-pulse" style={{ animationDelay: '0.3s' }}>▸ Identifying decision makers...</div>
                  <div className="animate-pulse" style={{ animationDelay: '0.6s' }}>▸ Matching against ICP...</div>
                </div>
              </div>

              <div className="mb-6">
                <div className="h-4 bg-gray-800 border-2 border-cyan-400">
                  <div 
                    className="h-full bg-cyan-400 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>

              <div className="text-cyan-400 font-mono text-xl">{Math.round(progress)}%</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // REVIEW STAGE - Contact cards
  if (stage === 'review') {
    const currentContact = contacts[currentContactIndex];
    const companySelections = allSelections[currentCompany.id || currentCompany.name] || { accepted: [], rejected: [] };

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />

        <div className="relative z-10 py-8 px-6">
          <div className="max-w-5xl mx-auto">
            {/* Progress */}
            <div className="mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-purple-400 font-mono text-sm">
                  {currentCompany.name} - CONTACT {currentContactIndex + 1} / {contacts.length}
                </span>
                <span className="text-green-400 font-mono text-sm">
                  ✓ {companySelections.accepted.length} SELECTED
                </span>
              </div>
              <div className="h-2 bg-gray-800 border border-purple-400/30">
                <div 
                  className="h-full bg-purple-400 transition-all duration-300"
                  style={{ width: `${((currentContactIndex) / contacts.length) * 100}%` }}
                ></div>
              </div>
            </div>

            {/* Contact Card */}
            <div className="border-4 border-purple-400 bg-black/95 backdrop-blur-sm overflow-hidden">
              {/* Header */}
              <div className="border-b-2 border-purple-400 bg-purple-900/20 p-8">
                <div className="flex items-start gap-6">
                  {currentContact.photoUrl && (
                    <img 
                      src={currentContact.photoUrl} 
                      alt={currentContact.name}
                      className="w-32 h-32 border-4 border-purple-400 object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <h2 className="text-5xl font-bold text-purple-400 mb-3 font-mono">
                      {currentContact.name}
                    </h2>
                    <div className="text-2xl text-white font-mono mb-3">{currentContact.title}</div>
                    <div className="text-xl text-purple-300 font-mono">{currentCompany.name}</div>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="p-8 space-y-6">
                {/* Contact Info */}
                <div className="grid md:grid-cols-2 gap-6">
                  {currentContact.email && (
                    <div className="border border-purple-400/30 bg-black/50 p-6">
                      <div className="text-base text-purple-400 font-mono mb-3">📧 EMAIL</div>
                      <a 
                        href={`mailto:${currentContact.email}`}
                        className="text-purple-300 hover:text-purple-200 font-mono text-xl break-all"
                      >
                        {currentContact.email}
                      </a>
                      <div className="text-sm text-gray-400 font-mono mt-2">
                        Status: {currentContact.emailStatus || 'unknown'}
                      </div>
                    </div>
                  )}

                  {currentContact.linkedinUrl && (
                    <div className="border border-purple-400/30 bg-black/50 p-6">
                      <div className="text-base text-purple-400 font-mono mb-3">💼 LINKEDIN</div>
                      <a 
                        href={currentContact.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 font-mono text-lg underline"
                      >
                        View Profile ↗
                      </a>
                    </div>
                  )}
                </div>

                {/* Seniority & Departments */}
                <div className="grid md:grid-cols-2 gap-6">
                  {currentContact.seniority && (
                    <div className="border border-purple-400/30 bg-black/50 p-6">
                      <div className="text-base text-purple-400 font-mono mb-3">🎯 SENIORITY</div>
                      <div className="text-2xl text-white font-mono capitalize">{currentContact.seniority}</div>
                    </div>
                  )}

                  {currentContact.departments && currentContact.departments.length > 0 && (
                    <div className="border border-purple-400/30 bg-black/50 p-6">
                      <div className="text-base text-purple-400 font-mono mb-3">🏢 DEPARTMENTS</div>
                      <div className="flex flex-wrap gap-2">
                        {currentContact.departments.map((dept, idx) => (
                          <span 
                            key={idx}
                            className="px-3 py-1 border border-purple-400/50 bg-purple-900/20 text-purple-300 font-mono text-sm"
                          >
                            {dept}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Employment History */}
                {currentContact.employmentHistory && currentContact.employmentHistory.length > 0 && (
                  <div className="border border-purple-400/30 bg-black/50 p-6">
                    <div className="text-base text-purple-400 font-mono mb-4">📋 EMPLOYMENT HISTORY</div>
                    <div className="space-y-4">
                      {currentContact.employmentHistory.slice(0, 3).map((job, idx) => (
                        <div key={idx} className="border-l-2 border-purple-400/50 pl-4">
                          <div className="text-white font-mono text-lg font-bold">{job.title}</div>
                          <div className="text-purple-300 font-mono text-base">{job.company}</div>
                          <div className="text-gray-400 font-mono text-sm">
                            {job.startDate || 'N/A'} - {job.current ? 'Present' : (job.endDate || 'N/A')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="border-t-2 border-purple-400 bg-black p-8">
                <div className="text-center mb-6">
                  <div className="text-base text-purple-400 font-mono tracking-widest mb-2">SELECTION REQUIRED</div>
                  <p className="text-2xl text-white font-mono">Add to outreach list?</p>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <button
                    onClick={() => handleContactAction('reject')}
                    className="py-6 bg-gray-600 text-white text-2xl font-bold font-mono tracking-wider hover:bg-gray-500 transition-all border-4 border-gray-800"
                  >
                    ✗ PASS
                  </button>
                  <button
                    onClick={() => handleContactAction('accept')}
                    className="py-6 bg-green-600 text-white text-2xl font-bold font-mono tracking-wider hover:bg-green-500 transition-all border-4 border-green-800 shadow-lg shadow-green-600/30"
                  >
                    ✓ SELECT
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // SUMMARY STAGE - Company complete
  if (stage === 'summary') {
    const companySelections = allSelections[currentCompany.id || currentCompany.name] || { accepted: [], rejected: [] };
    const isLastCompany = currentCompanyIndex === totalCompanies - 1;

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-4xl mx-auto">
            <div className="border-4 border-green-400 bg-black/90 backdrop-blur-sm p-12">
              <div className="text-center mb-10">
                <div className="text-8xl mb-6">✓</div>
                <h2 className="text-5xl font-bold text-green-400 mb-6 font-mono">
                  [ TARGET COMPLETE ]
                </h2>
                <div className="text-2xl text-green-300 font-mono">
                  {currentCompany.name}
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-8 mb-10">
                <div className="border-2 border-green-400 bg-black p-8 text-center">
                  <div className="text-base text-green-400 font-mono mb-3">CONTACTS SELECTED</div>
                  <div className="text-7xl font-bold text-green-400 mb-3 font-mono">
                    {companySelections.accepted.length}
                  </div>
                  <div className="text-green-300 font-mono">READY FOR OUTREACH</div>
                </div>
                <div className="border-2 border-gray-400 bg-black p-8 text-center">
                  <div className="text-base text-gray-400 font-mono mb-3">CONTACTS PASSED</div>
                  <div className="text-7xl font-bold text-gray-400 mb-3 font-mono">
                    {companySelections.rejected.length}
                  </div>
                  <div className="text-gray-500 font-mono">NOT PURSUING</div>
                </div>
              </div>

              <button
                onClick={handleNextCompany}
                className="w-full py-8 bg-green-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600"
              >
                {isLastCompany ? '[ COMPLETE MISSION ] →' : '[ NEXT TARGET ] →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // COMPLETE STAGE - All done
  if (stage === 'complete') {
    const totalAccepted = Object.values(allSelections).reduce((sum, sel) => sum + sel.accepted.length, 0);
    const totalRejected = Object.values(allSelections).reduce((sum, sel) => sum + sel.rejected.length, 0);

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-5xl mx-auto">
            <div className="border-4 border-green-400 bg-black/90 backdrop-blur-sm p-12 mb-8">
              <div className="text-center">
                <div className="text-9xl mb-8">🎯</div>
                <div className="text-xl text-green-400 mb-4 font-mono tracking-widest">MISSION COMPLETE</div>
                <h1 className="text-7xl font-bold text-green-400 mb-10 font-mono">
                  [ PHASE 3: SUCCESS ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-12 py-6">
                  <div className="text-3xl text-green-400 font-mono tracking-wider">
                    {totalAccepted} CONTACTS LOCKED
                  </div>
                </div>
              </div>
            </div>

            <div className="border-2 border-green-400/50 bg-black/90 backdrop-blur-sm p-10">
              <div className="grid md:grid-cols-3 gap-6 mb-8">
                <div className="border-2 border-green-400 bg-black p-8 text-center">
                  <div className="text-sm text-green-400 font-mono mb-2">TARGETS SCANNED</div>
                  <div className="text-6xl font-bold text-green-400 mb-2 font-mono">
                    {totalCompanies}
                  </div>
                  <div className="text-green-300 font-mono">COMPANIES</div>
                </div>
                <div className="border-2 border-green-400 bg-black p-8 text-center">
                  <div className="text-sm text-green-400 font-mono mb-2">CONTACTS SELECTED</div>
                  <div className="text-6xl font-bold text-green-400 mb-2 font-mono">
                    {totalAccepted}
                  </div>
                  <div className="text-green-300 font-mono">READY</div>
                </div>
                <div className="border-2 border-gray-400 bg-black p-8 text-center">
                  <div className="text-sm text-gray-400 font-mono mb-2">CONTACTS PASSED</div>
                  <div className="text-6xl font-bold text-gray-400 mb-2 font-mono">
                    {totalRejected}
                  </div>
                  <div className="text-gray-500 font-mono">FILTERED</div>
                </div>
              </div>

              <div className="border-2 border-yellow-400 bg-yellow-900/10 p-8">
                <div className="flex items-start gap-4">
                  <div className="text-5xl">→</div>
                  <div className="flex-1">
                    <h3 className="text-yellow-400 font-bold font-mono text-2xl mb-3">NEXT: INTELLIGENCE RANKING</h3>
                    <p className="text-yellow-200 font-mono text-lg">
                      Barry will now analyze and rank your {totalAccepted} selected contacts for optimal outreach sequencing.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
