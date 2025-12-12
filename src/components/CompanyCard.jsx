// Module 6: Company Matching - CompanyCard Component

import React from 'react';

export default function CompanyCard({ company, isSelected, onToggle }) {
  return (
    <div
      className={`bg-gray-900 border-2 rounded-lg p-6 transition-all cursor-pointer ${
        isSelected
          ? 'border-cyan-400 bg-cyan-400/10'
          : 'border-gray-700 hover:border-gray-600'
      }`}
      onClick={onToggle}
    >
      {/* Checkbox */}
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">
          <div
            className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
              isSelected
                ? 'border-cyan-400 bg-cyan-400'
                : 'border-gray-600 bg-gray-800'
            }`}
          >
            {isSelected && (
              <svg
                className="w-4 h-4 text-black"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
        </div>

        {/* Company Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold text-white mb-2 truncate">
            {company.name}
          </h3>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Industry:</span>
              <span className="text-gray-300">{company.industry}</span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Size:</span>
              <span className="text-gray-300">
                {typeof company.size === 'number'
                  ? `${company.size} employees`
                  : company.size}
              </span>
            </div>

            {company.location && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">Location:</span>
                <span className="text-gray-300">{company.location}</span>
              </div>
            )}

            {company.website && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">Website:</span>
                <a
                  href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {company.website}
                </a>
              </div>
            )}

            {company.description && (
              <div className="mt-3">
                <p className="text-sm text-gray-400 line-clamp-2">
                  {company.description}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
