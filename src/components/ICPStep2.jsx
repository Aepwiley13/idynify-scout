// Module 4: ICP Builder - Step 2: Company Sizes (multi-select)

import React from 'react';
import { COMPANY_SIZES } from '../constants/icpOptions';

export default function ICPStep2({ selectedSizes = [], onSelect, onNext, onBack }) {
  const handleToggle = (size) => {
    if (selectedSizes.includes(size)) {
      onSelect(selectedSizes.filter(s => s !== size));
    } else {
      onSelect([...selectedSizes, size]);
    }
  };

  const isValid = selectedSizes.length > 0;

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-cyan-400 mb-4">Step 2: Select Company Sizes</h1>
        <p className="text-gray-400 mb-8">Choose the company sizes you want to target (select at least one)</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {COMPANY_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => handleToggle(size)}
              className={`p-6 rounded-lg border-2 transition-all ${
                selectedSizes.includes(size)
                  ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                  : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-600'
              }`}
            >
              <div className="text-2xl font-bold">{size}</div>
              <div className="text-sm text-gray-500 mt-2">employees</div>
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
            {selectedSizes.length} selected
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
