import { useState } from 'react';
import './ReconEnterprise.css';

export default function SectionOutputModal({ section, onClose }) {
  const [activeTab, setActiveTab] = useState('summary');

  if (!section || !section.data) {
    return null;
  }

  const data = section.data;
  const executiveSummary = data.executiveSummary || {};
  const rawAnswers = data.rawAnswers || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm p-4">
      <div className="bg-gradient-to-br from-gray-900 to-black border-2 border-gray-300/30 rounded-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-white/60 border-b border-gray-300/30 p-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">
              Section {section.sectionId}: {section.title}
            </h2>
            <p className="text-gray-400 text-sm">Generated AI Intelligence Output</p>
          </div>
          <button
            onClick={onClose}
            className="text-3xl text-gray-400 hover:text-gray-900 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-white/40 border-b border-gray-300/20 px-6 flex gap-2">
          <button
            onClick={() => setActiveTab('summary')}
            className={`px-6 py-3 font-bold transition-all ${
              activeTab === 'summary'
                ? 'text-blue-600 border-b-2 border-gray-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            📊 EXECUTIVE SUMMARY
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={`px-6 py-3 font-bold transition-all ${
              activeTab === 'raw'
                ? 'text-blue-600 border-b-2 border-gray-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            📝 YOUR ANSWERS
          </button>
          <button
            onClick={() => setActiveTab('json')}
            className={`px-6 py-3 font-bold transition-all ${
              activeTab === 'json'
                ? 'text-blue-600 border-b-2 border-gray-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            🔧 RAW DATA
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'summary' && (
            <div className="space-y-4">
              {/* Render Executive Summary based on section structure */}
              {renderExecutiveSummary(section.sectionId, executiveSummary)}
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Your Input Data</h3>
              {Object.entries(rawAnswers).map(([key, value]) => (
                <div key={key} className="bg-white/40 rounded-lg p-4 border border-gray-300/20">
                  <p className="text-sm text-gray-400 mb-2 uppercase">{formatFieldName(key)}</p>
                  <p className="text-gray-900 whitespace-pre-wrap">
                    {Array.isArray(value) ? value.join(', ') : value}
                  </p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'json' && (
            <div className="bg-white rounded-lg p-4 border border-gray-300/20">
              <pre className="text-green-400 text-xs overflow-x-auto">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-white/60 border-t border-gray-300/30 p-4 flex justify-between items-center">
          <div className="text-xs text-gray-500">
            {data.metadata && (
              <>
                Generated {new Date(data.completedAt || section.completedAt).toLocaleDateString()} •{' '}
                {data.metadata.model} •{' '}
                {data.metadata.tokensUsed} tokens
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="bg-cyan-500/20 hover:bg-cyan-500/30 text-blue-600 px-6 py-2 rounded-lg border border-gray-300/30 font-bold transition-all"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}

function formatFieldName(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function renderExecutiveSummary(sectionId, summary) {
  // Section 1: Company Identity
  if (sectionId === 1) {
    return (
      <>
        <SummaryCard title="Company Overview" data={summary.companyOverview} />
        <SummaryCard title="Core Offering" data={summary.coreOffering} />
        <SummaryCard title="Current State" data={summary.currentState} />

        <div className="bg-gradient-to-br from-cyan-900/20 to-blue-900/20 rounded-lg p-4 border border-gray-300/30">
          <h4 className="text-lg font-bold text-blue-600 mb-3">👥 IDEAL CUSTOMER AT A GLANCE</h4>
          <p className="text-gray-900 text-lg leading-relaxed">{summary.idealCustomerGlance}</p>
        </div>

        <div className="bg-gradient-to-br from-green-900/20 to-emerald-900/20 rounded-lg p-4 border border-green-500/30">
          <h4 className="text-lg font-bold text-green-400 mb-3">✅ PERFECT FIT INDICATORS</h4>
          <ul className="space-y-2">
            {summary.perfectFitIndicators?.map((indicator, i) => (
              <li key={i} className="flex items-start gap-3 text-gray-900">
                <span className="text-green-400 flex-shrink-0">✓</span>
                <span>{indicator}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-gradient-to-br from-red-900/20 to-orange-900/20 rounded-lg p-4 border border-red-500/30">
          <h4 className="text-lg font-bold text-red-400 mb-3">🚫 ANTI-PROFILE (AVOID THESE)</h4>
          <ul className="space-y-2">
            {summary.antiProfile?.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-gray-900">
                <span className="text-red-400 flex-shrink-0">✕</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 rounded-lg p-4 border border-purple-500/30">
          <h4 className="text-lg font-bold text-purple-400 mb-3">💡 KEY INSIGHT</h4>
          <p className="text-gray-900 text-lg leading-relaxed">{summary.keyInsight}</p>
        </div>
      </>
    );
  }

  // Generic rendering for other sections
  return (
    <div className="space-y-4">
      {Object.entries(summary).map(([key, value]) => (
        <SummaryCard key={key} title={formatFieldName(key)} data={value} />
      ))}
    </div>
  );
}

function SummaryCard({ title, data }) {
  if (!data) return null;

  return (
    <div className="bg-white/40 rounded-lg p-4 border border-gray-300/20">
      <h4 className="text-lg font-bold text-blue-600 mb-3">{title}</h4>

      {typeof data === 'string' ? (
        <p className="text-gray-900 leading-relaxed">{data}</p>
      ) : typeof data === 'object' && !Array.isArray(data) ? (
        <div className="space-y-3">
          {Object.entries(data).map(([key, value]) => (
            <div key={key}>
              <p className="text-sm text-gray-400 mb-1">{formatFieldName(key)}</p>
              <p className="text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      ) : Array.isArray(data) ? (
        <ul className="space-y-2">
          {data.map((item, i) => (
            <li key={i} className="flex items-start gap-3 text-gray-900">
              <span className="text-blue-600 flex-shrink-0">•</span>
              <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-900">{String(data)}</p>
      )}
    </div>
  );
}
