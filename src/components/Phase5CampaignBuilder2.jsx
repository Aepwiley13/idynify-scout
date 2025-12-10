import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase/config';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function Phase5CampaignBuilder({ phase4Data, scoutData, onComplete }) {
  const navigate = useNavigate();
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [campaigns, setCampaigns] = useState({}); // { contactId: campaign }
  const [generatingFor, setGeneratingFor] = useState(null);
  const [campaignType, setCampaignType] = useState('email');
  const [stage, setStage] = useState('selection'); // selection, generation, export
  const [error, setError] = useState(null);

  const contacts = phase4Data.rankedContacts || [];

  // Auto-select top 10 contacts
  useEffect(() => {
    const top10 = contacts.slice(0, Math.min(10, contacts.length)).map(c => c.id);
    setSelectedContacts(top10);
  }, []);

  const toggleContact = (contactId) => {
    setSelectedContacts(prev => 
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const generateCampaignsForSelected = async () => {
    try {
      setStage('generation');
      setError(null);

      const selectedContactObjs = contacts.filter(c => selectedContacts.includes(c.id));

      for (const contact of selectedContactObjs) {
        setGeneratingFor(contact.id);

        const response = await fetch('/.netlify/functions/barry-phase5-campaign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: auth.currentUser.uid,
            contact: contact,
            scoutData: scoutData,
            campaignType: campaignType
          })
        });

        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || `Failed for ${contact.name}`);
        }

        setCampaigns(prev => ({
          ...prev,
          [contact.id]: data.campaign
        }));

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setGeneratingFor(null);
      setStage('export');
      
      // Save to Firebase
      await saveCampaignsToFirebase();

    } catch (err) {
      console.error('❌ Campaign generation error:', err);
      setError(err.message);
      setGeneratingFor(null);
    }
  };

  const saveCampaignsToFirebase = async () => {
    try {
      const user = auth.currentUser;
      await setDoc(doc(db, 'missions', user.uid, 'current', 'phase5'), {
        campaigns: campaigns,
        campaignType: campaignType,
        selectedContactIds: selectedContacts,
        completedAt: serverTimestamp()
      });
      console.log('💾 Campaigns saved to Firebase');
    } catch (err) {
      console.error('Error saving campaigns:', err);
    }
  };

  const exportToCSV = () => {
    const selectedContactObjs = contacts.filter(c => selectedContacts.includes(c.id));
    
    let csv = 'Rank,Name,Title,Company,Email,LinkedIn,Score,';
    csv += campaignType === 'email' 
      ? 'Email Subject 1,Email Body 1,Email Subject 2,Email Body 2,Email Subject 3,Email Body 3\n'
      : 'LinkedIn Connection Request,LinkedIn Follow-up\n';

    selectedContactObjs.forEach(contact => {
      const company = contact.companyContext || contact.organization || {};
      const campaign = campaigns[contact.id];
      
      const row = [
        contact.barryRank,
        `"${contact.name}"`,
        `"${contact.title}"`,
        `"${company.name}"`,
        contact.email || '',
        contact.linkedinUrl || '',
        contact.barryScore
      ];

      if (campaign) {
        if (campaignType === 'email' && campaign.variations) {
          campaign.variations.forEach(v => {
            row.push(`"${v.subject}"`, `"${v.body.replace(/\n/g, ' ')}"`);
          });
        } else if (campaignType === 'linkedin') {
          row.push(
            `"${campaign.connectionRequest}"`,
            `"${campaign.followUp}"`
          );
        }
      }

      csv += row.join(',') + '\n';
    });

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `idynify-campaign-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  // Shared components
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

  // SELECTION STAGE
  if (stage === 'selection') {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:READY]', '[CAMPAIGN:BUILDER]', '[OUTREACH:PENDING]', '[MISSION:PHASE5]', '[PERSONALIZATION:AI]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-7xl mx-auto">
            
            {/* Header */}
            <div className="border-4 border-cyan-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-xl text-cyan-400 mb-4 font-mono tracking-widest">FINAL STEP</div>
                <h1 className="text-7xl font-bold text-cyan-400 mb-8 font-mono">
                  [ PHASE 5: CAMPAIGN BUILDER ]
                </h1>
                <p className="text-cyan-300 font-mono text-2xl">
                  Select contacts and Barry will generate personalized outreach
                </p>
              </div>
            </div>

            {/* Campaign Type Selector */}
            <div className="border-2 border-purple-400 bg-black/90 backdrop-blur-sm p-10 mb-10">
              <h3 className="text-purple-400 font-bold font-mono text-3xl mb-6">📧 CAMPAIGN TYPE</h3>
              
              <div className="grid md:grid-cols-2 gap-6">
                <button
                  onClick={() => setCampaignType('email')}
                  className={`p-8 border-2 transition-all ${
                    campaignType === 'email'
                      ? 'border-green-400 bg-green-900/20'
                      : 'border-gray-600 bg-gray-900/20 hover:border-gray-400'
                  }`}
                >
                  <div className="text-5xl mb-4">📧</div>
                  <h4 className="text-white font-bold font-mono text-2xl mb-2">EMAIL CAMPAIGN</h4>
                  <p className="text-gray-400 font-mono text-base">
                    3 email variations with subjects + bodies
                  </p>
                </button>

                <button
                  onClick={() => setCampaignType('linkedin')}
                  className={`p-8 border-2 transition-all ${
                    campaignType === 'linkedin'
                      ? 'border-green-400 bg-green-900/20'
                      : 'border-gray-600 bg-gray-900/20 hover:border-gray-400'
                  }`}
                >
                  <div className="text-5xl mb-4">💼</div>
                  <h4 className="text-white font-bold font-mono text-2xl mb-2">LINKEDIN CAMPAIGN</h4>
                  <p className="text-gray-400 font-mono text-base">
                    Connection request + follow-up message
                  </p>
                </button>
              </div>
            </div>

            {/* Contact Selection */}
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-10 mb-6">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-cyan-400 font-bold font-mono text-3xl">👥 SELECT CONTACTS</h3>
                  <p className="text-cyan-300 font-mono text-lg mt-2">
                    {selectedContacts.length} of {contacts.length} selected
                  </p>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setSelectedContacts(contacts.slice(0, 10).map(c => c.id))}
                    className="px-6 py-3 bg-gray-700 text-white font-mono hover:bg-gray-600"
                  >
                    TOP 10
                  </button>
                  <button
                    onClick={() => setSelectedContacts(contacts.map(c => c.id))}
                    className="px-6 py-3 bg-gray-700 text-white font-mono hover:bg-gray-600"
                  >
                    SELECT ALL
                  </button>
                  <button
                    onClick={() => setSelectedContacts([])}
                    className="px-6 py-3 bg-gray-700 text-white font-mono hover:bg-gray-600"
                  >
                    CLEAR
                  </button>
                </div>
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {contacts.map(contact => {
                  const company = contact.companyContext || contact.organization || {};
                  const isSelected = selectedContacts.includes(contact.id);

                  return (
                    <div
                      key={contact.id}
                      onClick={() => toggleContact(contact.id)}
                      className={`border-2 p-6 cursor-pointer transition-all ${
                        isSelected
                          ? 'border-green-400 bg-green-900/20'
                          : 'border-gray-700 bg-gray-900/20 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-8 h-8 border-2 flex items-center justify-center ${
                          isSelected ? 'border-green-400 bg-green-400' : 'border-gray-600'
                        }`}>
                          {isSelected && <span className="text-black font-bold">✓</span>}
                        </div>
                        
                        <div className="flex-1">
                          <div className="flex items-center gap-4 mb-2">
                            <span className="text-cyan-400 font-mono text-lg">#{contact.barryRank}</span>
                            <span className="text-white font-bold font-mono text-xl">{contact.name}</span>
                            <span className="text-gray-400 font-mono text-base">{contact.title}</span>
                          </div>
                          <div className="flex gap-6 text-sm font-mono text-gray-400">
                            <span>🏢 {company.name}</span>
                            <span>📊 Score: {contact.barryScore}</span>
                            {contact.email && <span>📧 Email</span>}
                            {contact.linkedinUrl && <span>💼 LinkedIn</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Generate Button */}
            {selectedContacts.length > 0 && (
              <button
                onClick={generateCampaignsForSelected}
                className="w-full py-8 bg-green-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600 shadow-lg shadow-green-400/50"
              >
                [ GENERATE {selectedContacts.length} CAMPAIGNS ] →
              </button>
            )}

          </div>
        </div>
      </div>
    );
  }

  // GENERATION STAGE
  if (stage === 'generation') {
    const totalSelected = selectedContacts.length;
    const completed = Object.keys(campaigns).length;
    const progress = (completed / totalSelected) * 100;

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:WRITING]', '[AI:PERSONALIZING]', '[CAMPAIGN:GENERATING]', '[MISSION:PHASE5]']} />

        <div className="relative z-10 flex items-center justify-center min-h-screen px-6">
          <div className="text-center max-w-4xl w-full">
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-12">
              <div className="text-9xl mb-8">✍️</div>
              <h2 className="text-6xl font-bold text-cyan-400 mb-10 font-mono">
                BARRY IS WRITING...
              </h2>
              
              <div className="mb-10">
                <div className="w-full bg-gray-800 h-6 border border-cyan-400/30 mb-4">
                  <div 
                    className="bg-gradient-to-r from-cyan-400 to-green-400 h-full transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="text-cyan-300 font-mono text-2xl">
                  {completed} of {totalSelected} campaigns generated
                </div>
              </div>

              {generatingFor && (
                <div className="text-yellow-400 font-mono text-xl animate-pulse">
                  Generating for: {contacts.find(c => c.id === generatingFor)?.name}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Continue in next message...
  return null;
}

  // EXPORT STAGE
  if (stage === 'export') {
    const selectedContactObjs = contacts.filter(c => selectedContacts.includes(c.id));

    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <SpaceBackground />
        <FloatingCode codes={['[BARRY:COMPLETE]', '[CAMPAIGNS:READY]', '[EXPORT:AVAILABLE]', '[MISSION:SUCCESS]']} />

        <div className="relative z-10 py-12 px-6">
          <div className="max-w-7xl mx-auto">
            
            {/* Header */}
            <div className="border-4 border-green-400 bg-black/90 backdrop-blur-sm p-12 mb-10">
              <div className="text-center">
                <div className="text-8xl mb-6">✓</div>
                <div className="text-xl text-green-400 mb-4 font-mono tracking-widest">CAMPAIGNS READY</div>
                <h1 className="text-7xl font-bold text-green-400 mb-8 font-mono">
                  [ PHASE 5: COMPLETE ]
                </h1>
                <div className="inline-block border-2 border-green-400 bg-green-900/20 px-10 py-5">
                  <div className="text-2xl text-green-400 font-mono tracking-wider">
                    {Object.keys(campaigns).length} CAMPAIGNS GENERATED
                  </div>
                </div>
              </div>
            </div>

            {/* Export Actions */}
            <div className="border-2 border-purple-400 bg-black/90 backdrop-blur-sm p-10 mb-10">
              <h3 className="text-purple-400 font-bold font-mono text-3xl mb-6">📤 EXPORT OPTIONS</h3>
              
              <div className="flex gap-6">
                <button
                  onClick={exportToCSV}
                  className="flex-1 py-6 bg-green-600 text-white text-2xl font-bold font-mono hover:bg-green-500 transition-all border-2 border-green-800"
                >
                  📊 EXPORT TO CSV
                </button>
                <button
                  onClick={() => setStage('selection')}
                  className="px-8 py-6 bg-gray-700 text-white text-xl font-mono hover:bg-gray-600"
                >
                  ← BACK
                </button>
              </div>
            </div>

            {/* Campaign Preview */}
            <div className="border-2 border-cyan-400 bg-black/90 backdrop-blur-sm p-10">
              <h3 className="text-cyan-400 font-bold font-mono text-3xl mb-8">👁️ CAMPAIGN PREVIEW</h3>
              
              <div className="space-y-8">
                {selectedContactObjs.map(contact => {
                  const campaign = campaigns[contact.id];
                  const company = contact.companyContext || contact.organization || {};

                  if (!campaign) return null;

                  return (
                    <div key={contact.id} className="border-2 border-purple-400 bg-black p-8">
                      {/* Contact Header */}
                      <div className="flex items-center justify-between mb-6 pb-6 border-b border-purple-400/30">
                        <div>
                          <h4 className="text-white font-bold font-mono text-2xl mb-2">
                            #{contact.barryRank} {contact.name}
                          </h4>
                          <div className="text-purple-300 font-mono text-lg">
                            {contact.title} at {company.name}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-400 font-mono mb-1">SCORE</div>
                          <div className="text-4xl font-bold text-purple-400 font-mono">{contact.barryScore}</div>
                        </div>
                      </div>

                      {/* Email Campaigns */}
                      {campaignType === 'email' && campaign.variations && (
                        <div className="space-y-6">
                          {campaign.variations.map((variation, idx) => (
                            <div key={variation.id} className="border border-cyan-400/30 bg-cyan-900/10 p-6">
                              <div className="flex items-center justify-between mb-4">
                                <div className="text-cyan-400 font-mono text-sm">
                                  EMAIL VARIATION {idx + 1} ({variation.style})
                                </div>
                                <button
                                  onClick={() => copyToClipboard(`Subject: ${variation.subject}\n\n${variation.body}`)}
                                  className="px-4 py-2 bg-cyan-600 text-white text-sm font-mono hover:bg-cyan-500"
                                >
                                  📋 COPY
                                </button>
                              </div>
                              
                              <div className="mb-4">
                                <div className="text-xs text-gray-400 font-mono mb-2">SUBJECT:</div>
                                <div className="text-white font-mono text-lg font-bold">{variation.subject}</div>
                              </div>
                              
                              <div>
                                <div className="text-xs text-gray-400 font-mono mb-2">BODY:</div>
                                <div className="text-gray-200 font-mono text-base whitespace-pre-line">
                                  {variation.body}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* LinkedIn Campaigns */}
                      {campaignType === 'linkedin' && (
                        <div className="space-y-6">
                          <div className="border border-blue-400/30 bg-blue-900/10 p-6">
                            <div className="flex items-center justify-between mb-4">
                              <div className="text-blue-400 font-mono text-sm">
                                CONNECTION REQUEST
                              </div>
                              <button
                                onClick={() => copyToClipboard(campaign.connectionRequest)}
                                className="px-4 py-2 bg-blue-600 text-white text-sm font-mono hover:bg-blue-500"
                              >
                                📋 COPY
                              </button>
                            </div>
                            <div className="text-gray-200 font-mono text-base">
                              {campaign.connectionRequest}
                            </div>
                            <div className="text-xs text-gray-400 font-mono mt-2">
                              {campaign.connectionRequest.length}/250 characters
                            </div>
                          </div>

                          <div className="border border-blue-400/30 bg-blue-900/10 p-6">
                            <div className="flex items-center justify-between mb-4">
                              <div className="text-blue-400 font-mono text-sm">
                                FOLLOW-UP MESSAGE
                              </div>
                              <button
                                onClick={() => copyToClipboard(campaign.followUp)}
                                className="px-4 py-2 bg-blue-600 text-white text-sm font-mono hover:bg-blue-500"
                              >
                                📋 COPY
                              </button>
                            </div>
                            <div className="text-gray-200 font-mono text-base whitespace-pre-line">
                              {campaign.followUp}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Complete Mission */}
            <div className="mt-10">
              <button
                onClick={() => navigate('/mission-control')}
                className="w-full py-8 bg-green-400 text-black text-3xl font-bold font-mono tracking-wider hover:bg-green-300 transition-all border-4 border-green-600 shadow-lg shadow-green-400/50"
              >
                [ MISSION COMPLETE! ] 🎉
              </button>
            </div>

          </div>
        </div>
      </div>
    );
  }

  return null;
}
