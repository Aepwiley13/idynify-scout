// Module 4: ICP Builder - Step 3: Target Titles (multi-select)

import React from 'react';
import { TARGET_TITLES } from '../constants/icpOptions';

export default function ICPStep3({ selectedTitles = [], onSelect, onNext, onBack }) {
  const handleToggle = (title) => {
    if (selectedTitles.includes(title)) {
      onSelect(selectedTitles.filter(t => t !== title));
    } else {
      onSelect([...selectedTitles, title]);
    }
  };

  const isValid = selectedTitles.length > 0;

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-cyan-400 mb-4">Step 3: Select Target Titles</h1>
        <p className="text-gray-400 mb-8">Choose the job titles you want to target (select at least one)</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {TARGET_TITLES.map((title) => (
            <button
              key={title}
              onClick={() => handleToggle(title)}
              className={`p-4 rounded-lg border-2 transition-all ${
                selectedTitles.includes(title)
                  ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                  : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600'
              }`}
            >
              {title}
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center">
          <button
            onClick={onBack}
            className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Back
          </button>

          <div className="text-gray-400">
            {selectedTitles.length} selected
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
