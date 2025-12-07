import { useState } from 'react';

export default function GenerateLinkedInModal({ prospect, icpData, onClose, onGenerated }) {
  const [generating, setGenerating] = useState(false);
  const [generatedMessage, setGeneratedMessage] = useState('');
  const [messageType, setMessageType] = useState('connection_request');
  const [tone, setTone] = useState('professional');
  const [copied, setCopied] = useState(false);

  const messageTypes = [
    { value: 'connection_request', label: 'Connection Request (300 chars)' },
    { value: 'follow_up', label: 'Follow-up Message' },
    { value: 'inmail', label: 'InMail (longer form)' }
  ];

  const tones = [
    { value: 'professional', label: 'Professional' },
    { value: 'casual', label: 'Casual' },
    { value: 'enthusiastic', label: 'Enthusiastic' }
  ];

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const response = await fetch('/.netlify/functions/generate-linkedin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect: {
            name: prospect.name,
            title: prospect.title,
            company: prospect.organization_name,
            industry: prospect.industry,
            location: `${prospect.city}, ${prospect.state}`
          },
          icpData: {
            company: icpData?.company || 'your company',
            industry: icpData?.industry || '',
            targetIndustry: icpData?.targetIndustry || '',
            valueProposition: icpData?.valueProposition || ''
          },
          messageType,
          tone
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      setGeneratedMessage(data.message);
      onGenerated(data.message);
    } catch (error) {
      console.error('Error generating LinkedIn message:', error);
      alert('Failed to generate LinkedIn message. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getCharCount = () => {
    return generatedMessage.length;
  };

  const isConnectionRequest = messageType === 'connection_request';
  const charLimit = isConnectionRequest ? 300 : null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-blue-500/30 max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-blue-500/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-white mb-1">Generate LinkedIn Message</h2>
              <p className="text-blue-300">
                AI-powered message for {prospect.name} at {prospect.organization_name}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-blue-400 hover:text-blue-300 text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!generatedMessage && (
            <div className="space-y-4">
              <div>
                <label className="block text-blue-200 font-semibold mb-2">
                  Message Type
                </label>
                <div className="space-y-2">
                  {messageTypes.map(type => (
                    <button
                      key={type.value}
                      onClick={() => setMessageType(type.value)}
                      className={`w-full p-3 rounded-lg border transition-all text-left ${
                        messageType === type.value
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-blue-500/30 text-blue-300 hover:border-blue-500/50'
                      }`}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-blue-200 font-semibold mb-2">
                  Tone
                </label>
                <div className="flex gap-2">
                  {tones.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setTone(t.value)}
                      className={`flex-1 p-3 rounded-lg border transition-all ${
                        tone === t.value
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-blue-500/30 text-blue-300 hover:border-blue-500/50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-blue-900/20 rounded-lg p-4 border border-blue-500/30">
                <h3 className="text-blue-200 font-semibold mb-2">💡 LinkedIn Best Practices</h3>
                <ul className="text-blue-300 text-sm space-y-1">
                  {isConnectionRequest ? (
                    <>
                      <li>• Keep it under 300 characters for connection requests</li>
                      <li>• Mention mutual connections or interests</li>
                      <li>• Be specific about why you're connecting</li>
                    </>
                  ) : (
                    <>
                      <li>• Reference their recent posts or achievements</li>
                      <li>• Lead with value, not your pitch</li>
                      <li>• Keep it conversational and authentic</li>
                    </>
                  )}
                </ul>
              </div>

              <div className="bg-gray-800/50 rounded-lg p-4 border border-blue-500/20">
                <h3 className="text-blue-200 font-semibold mb-2">Message will be personalized with:</h3>
                <ul className="text-blue-300 text-sm space-y-1">
                  <li>• {prospect.name}'s professional background</li>
                  <li>• {prospect.organization_name}'s industry focus</li>
                  <li>• Relevant pain points and solutions</li>
                  <li>• Natural conversation starters</li>
                </ul>
              </div>
            </div>
          )}

          {generatedMessage && (
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-lg p-4 border border-blue-500/30">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-blue-200 font-semibold">Generated Message</h3>
                    {charLimit && (
                      <span className={`text-sm ${
                        getCharCount() <= charLimit ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {getCharCount()}/{charLimit} chars
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleCopy}
                    className={`px-3 py-1 rounded-lg text-sm transition-colors ${
                      copied
                        ? 'bg-green-600 text-white'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {copied ? '✓ Copied!' : '📋 Copy'}
                  </button>
                </div>
                <div className="text-blue-200 whitespace-pre-wrap text-sm leading-relaxed">
                  {generatedMessage}
                </div>
              </div>

              {charLimit && getCharCount() > charLimit && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3">
                  <p className="text-red-300 text-sm">
                    ⚠️ Message exceeds {charLimit} character limit for connection requests. 
                    Consider regenerating or editing before sending.
                  </p>
                </div>
              )}
              
              <button
                onClick={() => {
                  setGeneratedMessage('');
                  setGenerating(false);
                }}
                className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                🔄 Generate New Message
              </button>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-blue-500/20 flex gap-3">
          {!generatedMessage ? (
            <>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                    Generating with Claude AI...
                  </span>
                ) : (
                  '✨ Generate Message'
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
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}