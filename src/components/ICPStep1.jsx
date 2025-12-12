// Module 4: ICP Builder - Step 1: Industries (multi-select)

import React from 'react';
import { INDUSTRIES } from '../constants/icpOptions';

export default function ICPStep1({ selectedIndustries = [], onSelect, onNext, onBack }) {
  const handleToggle = (industry) => {
    if (selectedIndustries.includes(industry)) {
      onSelect(selectedIndustries.filter(i => i !== industry));
    } else {
      onSelect([...selectedIndustries, industry]);
    }
  };

  const isValid = selectedIndustries.length > 0;

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-cyan-400 mb-4">Step 1: Select Industries</h1>
        <p className="text-gray-400 mb-8">Choose the industries you want to target (select at least one)</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {INDUSTRIES.map((industry) => (
            <button
              key={industry}
              onClick={() => handleToggle(industry)}
              className={`p-4 rounded-lg border-2 transition-all ${
                selectedIndustries.includes(industry)
                  ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                  : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600'
              }`}
            >
              {industry}
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center">
          <button
            onClick={onBack}
            className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
            disabled={!onBack}
          >
            Back
          </button>

          <div className="text-gray-400">
            {selectedIndustries.length} selected
          </div>

          <button
            onClick={onNext}
            disabled={!isValid}
            className={`px-6 py-3 rounded-lg transition-colors ${
              isValid
                ? 'bg-cyan-400 text-black hover:bg-cyan-300'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
