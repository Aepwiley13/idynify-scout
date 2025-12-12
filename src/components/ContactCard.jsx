// Module 9: Contact Suggestions - ContactCard Component

import React from 'react';

export default function ContactCard({
  contact,
  onAccept,
  onReject,
  onRequestAlternates,
  isProcessing
}) {
  return (
    <div className="bg-gray-900 border-2 border-gray-700 rounded-lg p-6">
      {/* Contact Info */}
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-white mb-2">
          {contact.name}
        </h3>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-sm">Title:</span>
            <span className="text-gray-300">{contact.title}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-gray-500 text-sm">Company:</span>
            <span className="text-gray-300">{contact.company_name}</span>
          </div>

          {contact.score && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">Match Score:</span>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-gray-700 rounded-full h-2 max-w-[100px]">
                  <div
                    className="bg-cyan-400 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(contact.score, 100)}%` }}
                  />
                </div>
                <span className="text-cyan-400 font-bold">{contact.score}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={onAccept}
          disabled={isProcessing}
          className={`flex-1 py-3 rounded-lg font-bold transition-colors ${
            isProcessing
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-500'
          }`}
        >
          {isProcessing ? 'Processing...' : 'Accept Contact'}
        </button>

        <button
          onClick={onReject}
          disabled={isProcessing}
          className={`flex-1 py-3 rounded-lg font-bold transition-colors ${
            isProcessing
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-red-600 text-white hover:bg-red-500'
          }`}
        >
          Reject Contact
        </button>
      </div>

      {/* Request Alternates Link */}
      <div className="mt-4 text-center">
        <button
          onClick={onRequestAlternates}
          disabled={isProcessing}
          className="text-cyan-400 hover:text-cyan-300 text-sm underline disabled:text-gray-600 disabled:no-underline"
        >
          Request Alternates
        </button>
      </div>
    </div>
  );
}
