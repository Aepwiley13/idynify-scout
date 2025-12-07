import { useState } from 'react';

export default function GenerateEmailModal({ prospect, icpData, onClose, onGenerated }) {
  const [generating, setGenerating] = useState(false);
  const [generatedEmail, setGeneratedEmail] = useState('');
  const [emailType, setEmailType] = useState('cold_outreach');
  const [tone, setTone] = useState('professional');
  const [copied, setCopied] = useState(false);

  const emailTypes = [
    { value: 'cold_outreach', label: 'Cold Outreach' },
    { value: 'follow_up', label: 'Follow-up' },
    { value: 'meeting_request', label: 'Meeting Request' },
    { value: 'value_add', label: 'Value-Add Content' }
  ];

  const tones = [
    { value: 'professional', label: 'Professional' },
    { value: 'casual', label: 'Casual' },
    { value: 'enthusiastic', label: 'Enthusiastic' }
  ];

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await fetch('/.netlify/functions/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect: {
            name: prospect.name,
            title: prospect.title,
            company: prospect.organization_name,
            industry: prospect.industry,
            location: `${prospect.city}, ${prospect.state}`,
            companySize: prospect.organization_num_employees
          },
          icpData: {
            company: icpData?.company || 'your company',
            industry: icpData?.industry || '',
            targetIndustry: icpData?.targetIndustry || '',
            companySize: icpData?.companySize || '',
            painPoints: icpData?.painPoints || '',
            valueProposition: icpData?.valueProposition || ''
          },
          emailType,
          tone
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setGeneratedEmail(data.email);
      onGenerated(data.email);
    } catch (error) {
      console.error('Error generating email:', error);
      alert('Failed to generate email. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-purple-500/30 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-purple-500/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Generate Email</h2>
              <p className="text-purple-300">
                AI-powered email for {prospect.name} at {prospect.organization_name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-purple-400 hover:text-purple-300 text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Options */}
          {!generatedEmail && (
            <div className="space-y-4">
              {/* Email Type */}
              <div>
                <label className="block text-purple-200 font-semibold mb-2">
                  Email Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {emailTypes.map(type => (
                    <button
                      key={type.value}
                      onClick={() => setEmailType(type.value)}
                      className={`p-3 rounded-lg border transition-all ${
                        emailType === type.value
                          ? 'bg-purple-600 border-purple-500 text-white'
                          : 'bg-gray-800 border-purple-500/30 text-purple-300 hover:border-purple-500/50'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tone */}
              <div>
                <label className="block text-purple-200 font-semibold mb-2">
                  Tone
                </label>
                <div className="flex gap-2">
                  {tones.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setTone(t.value)}
                      className={`flex-1 p-3 rounded-lg border transition-all ${
                        tone === t.value
                          ? 'bg-purple-600 border-purple-500 text-white'
                          : 'bg-gray-800 border-purple-500/30 text-purple-300 hover:border-purple-500/50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prospect Preview */}
              <div className="bg-gray-800/50 rounded-lg p-4 border border-purple-500/20">
                <h3 className="text-purple-200 font-semibold mb-2">Email will be personalized with:</h3>
                <ul className="text-purple-300 text-sm space-y-1">
                  <li>• {prospect.name}'s role as {prospect.title}</li>
                  <li>• {prospect.organization_name}'s industry ({prospect.industry || 'Unknown'})</li>
                  <li>• Company size and location context</li>
                  <li>• Your value proposition from ICP</li>
                </ul>
              </div>
            </div>
          )}

          {/* Generated Email */}
          {generatedEmail && (
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-lg p-4 border border-purple-500/30">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-purple-200 font-semibold">Generated Email</h3>
                  <button
                    onClick={handleCopy}
                    className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                      copied
                        ? 'bg-green-600 text-white'
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                    }`}
                  >
                    {copied ? '✓ Copied!' : '📋 Copy'}
                  </button>
                </div>
                <div className="text-purple-200 whitespace-pre-wrap font-mono text-sm">
                  {generatedEmail}
                </div>
              </div>

              <button
                onClick={() => {
                  setGeneratedEmail('');
                  setGenerating(false);
                }}
                className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                🔄 Generate New Email
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-purple-500/20 flex gap-3">
          {!generatedEmail ? (
            <>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                    Generating with Claude AI...
                  </span>
                ) : (
                  '✨ Generate Email'
                )}
              </button>
              <button
                onClick={onClose}
                className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-semibold"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}