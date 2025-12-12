// Module 4: ICP Builder - Step 4: Geographic Territories (multi-select)

import React from 'react';
import { TERRITORIES } from '../constants/icpOptions';

export default function ICPStep4({ selectedTerritories = [], onSelect, onSubmit, onBack, isSubmitting }) {
  const handleToggle = (territory) => {
    if (selectedTerritories.includes(territory)) {
      onSelect(selectedTerritories.filter(t => t !== territory));
    } else {
      onSelect([...selectedTerritories, territory]);
    }
  };

  const isValid = selectedTerritories.length > 0;

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-cyan-400 mb-4">Step 4: Select Geographic Territories</h1>
        <p className="text-gray-400 mb-8">Choose the geographic regions you want to target (select at least one)</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {TERRITORIES.map((territory) => (
            <button
              key={territory}
              onClick={() => handleToggle(territory)}
              className={`p-4 rounded-lg border-2 transition-all ${
                selectedTerritories.includes(territory)
                  ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                  : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600'
              }`}
            >
              {territory}
            </button>
          ))}
        </div>

        <div className="flex justify-between items-center">
          <button
            onClick={onBack}
            className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
            disabled={isSubmitting}
          >
            Back
          </button>

          <div className="text-gray-400">
            {selectedTerritories.length} selected
          </div>

          <button
            onClick={onSubmit}
            disabled={!isValid || isSubmitting}
            className={`px-6 py-3 rounded-lg transition-colors ${
              isValid && !isSubmitting
                ? 'bg-cyan-400 text-black hover:bg-cyan-300'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? 'Saving...' : 'Complete'}
          </button>
        </div>
      </div>
    </div>
  );
}
