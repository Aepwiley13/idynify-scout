import { useState } from 'react';

export default function ProspectCard({ 
  prospect, 
  onUpdateProspect, 
  onGenerateEmail, 
  onGenerateLinkedIn, 
  onEnrichProfile,
  onAddAction 
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(prospect.notes || '');

  const priorityColors = {
    A: 'bg-red-600 text-white',
    B: 'bg-yellow-600 text-white',
    C: 'bg-blue-600 text-white'
  };

  const statusOptions = [
    { value: 'new', label: '🆕 New', color: 'purple' },
    { value: 'contacted', label: '📧 Contacted', color: 'blue' },
    { value: 'replied', label: '💬 Replied', color: 'green' },
    { value: 'meeting', label: '🗓️ Meeting Booked', color: 'yellow' },
    { value: 'closed', label: '✅ Closed Won', color: 'green' },
    { value: 'lost', label: '❌ Lost', color: 'red' }
  ];

  const handlePriorityChange = (newPriority) => {
    onUpdateProspect(prospect.id, { priority: newPriority });
    onAddAction(prospect.id, 'priority_changed', { 
      from: prospect.priority, 
      to: newPriority 
    });
  };

  const handleStatusChange = (newStatus) => {
    onUpdateProspect(prospect.id, { prospectStatus: newStatus });
    onAddAction(prospect.id, 'status_changed', { 
      from: prospect.prospectStatus, 
      to: newStatus 
    });
  };

  const handleSaveNotes = () => {
    onUpdateProspect(prospect.id, { notes });
    setEditingNotes(false);
    if (notes !== prospect.notes) {
      onAddAction(prospect.id, 'notes_updated', { notes });
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const currentStatus = statusOptions.find(s => s.value === prospect.prospectStatus) || statusOptions[0];

  return (
    <div className="bg-black/30 backdrop-blur-sm rounded-xl border border-purple-500/20 overflow-hidden hover:border-purple-500/40 transition-all">
      {/* Header */}
      <div className="p-6 border-b border-purple-500/20">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-bold text-white">{prospect.name}</h3>
              {/* Priority Selector */}
              <div className="flex gap-1">
                {['A', 'B', 'C'].map(priority => (
                  <button
                    key={priority}
                    onClick={() => handlePriorityChange(priority)}
                    className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${
                      prospect.priority === priority
                        ? priorityColors[priority]
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {priority}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-purple-300 font-medium mb-1">{prospect.title}</p>
            <p className="text-purple-400">{prospect.organization_name}</p>
          </div>
          
          {/* Status Dropdown */}
          <select
            value={prospect.prospectStatus}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="px-4 py-2 bg-purple-600/20 text-purple-200 rounded-lg border border-purple-500/30 focus:outline-none focus:border-purple-500 cursor-pointer"
          >
            {statusOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Quick Info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-purple-400 text-xs mb-1">Location</p>
            <p className="text-purple-200 text-sm">{prospect.city}, {prospect.state}</p>
          </div>
          <div>
            <p className="text-purple-400 text-xs mb-1">Company Size</p>
            <p className="text-purple-200 text-sm">{prospect.organization_num_employees || 'N/A'}</p>
          </div>
          <div>
            <p className="text-purple-400 text-xs mb-1">Industry</p>
            <p className="text-purple-200 text-sm">{prospect.industry || 'N/A'}</p>
          </div>
          <div>
            <p className="text-purple-400 text-xs mb-1">LinkedIn</p>
            {prospect.linkedin_url ? (
              <a 
                href={prospect.linkedin_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-sm underline"
              >
                View Profile
              </a>
            ) : (
              <p className="text-purple-200 text-sm">N/A</p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => onGenerateEmail(prospect)}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
          >
            📧 Generate Email
          </button>
          <button
            onClick={() => onGenerateLinkedIn(prospect)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            💼 LinkedIn Message
          </button>
          <button
            onClick={() => onEnrichProfile(prospect.id)}
            className="px-4 py-2 bg-green-600/80 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            ✨ Enrich Profile
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-4 py-2 bg-gray-600/50 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium ml-auto"
          >
            {isExpanded ? '▲ Less' : '▼ More'}
          </button>
        </div>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="p-6 space-y-6">
          {/* Notes Section */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-purple-200 font-semibold">Notes</h4>
              {!editingNotes && (
                <button
                  onClick={() => setEditingNotes(true)}
                  className="text-purple-400 hover:text-purple-300 text-sm"
                >
                  ✏️ Edit
                </button>
              )}
            </div>
            {editingNotes ? (
              <div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-3 bg-gray-800/50 text-purple-200 rounded-lg border border-purple-500/30 focus:border-purple-500 focus:outline-none resize-none"
                  rows="4"
                  placeholder="Add notes about this prospect..."
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleSaveNotes}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setNotes(prospect.notes || '');
                      setEditingNotes(false);
                    }}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-gray-800/50 rounded-lg border border-purple-500/20">
                {prospect.notes ? (
                  <p className="text-purple-200 whitespace-pre-wrap">{prospect.notes}</p>
                ) : (
                  <p className="text-purple-400 italic">No notes yet. Click Edit to add notes.</p>
                )}
              </div>
            )}
          </div>

          {/* Contact Information */}
          <div>
            <h4 className="text-purple-200 font-semibold mb-3">Contact Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-gray-800/50 rounded-lg border border-purple-500/20">
                <p className="text-purple-400 text-xs mb-1">Email</p>
                <p className="text-purple-200">{prospect.email || 'Not available'}</p>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg border border-purple-500/20">
                <p className="text-purple-400 text-xs mb-1">Phone</p>
                <p className="text-purple-200">{prospect.phone_numbers?.[0] || 'Not available'}</p>
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg border border-purple-500/20">
                <p className="text-purple-400 text-xs mb-1">Company Website</p>
                {prospect.website_url ? (
                  <a 
                    href={prospect.website_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    {prospect.website_url}
                  </a>
                ) : (
                  <p className="text-purple-200">Not available</p>
                )}
              </div>
              <div className="p-3 bg-gray-800/50 rounded-lg border border-purple-500/20">
                <p className="text-purple-400 text-xs mb-1">Company Revenue</p>
                <p className="text-purple-200">{prospect.estimated_num_employees || 'Not available'}</p>
              </div>
            </div>
          </div>

          {/* Action History */}
          {prospect.actions && prospect.actions.length > 0 && (
            <div>
              <h4 className="text-purple-200 font-semibold mb-3">Activity Timeline</h4>
              <div className="space-y-2">
                {prospect.actions.slice().reverse().map((action, index) => (
                  <div 
                    key={index} 
                    className="p-3 bg-gray-800/50 rounded-lg border border-purple-500/20 flex items-start gap-3"
                  >
                    <span className="text-2xl">
                      {action.type === 'email_generated' ? '📧' :
                       action.type === 'linkedin_generated' ? '💼' :
                       action.type === 'enriched' ? '✨' :
                       action.type === 'priority_changed' ? '🎯' :
                       action.type === 'status_changed' ? '📊' :
                       action.type === 'notes_updated' ? '📝' :
                       '📌'}
                    </span>
                    <div className="flex-1">
                      <p className="text-purple-200 text-sm">
                        {action.type === 'email_generated' && 'Email template generated'}
                        {action.type === 'linkedin_generated' && 'LinkedIn message generated'}
                        {action.type === 'enriched' && 'Profile enriched from Apollo'}
                        {action.type === 'priority_changed' && `Priority changed from ${action.from} to ${action.to}`}
                        {action.type === 'status_changed' && `Status changed to ${action.to}`}
                        {action.type === 'notes_updated' && 'Notes updated'}
                      </p>
                      <p className="text-purple-400 text-xs mt-1">
                        {formatDate(action.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Additional Details */}
          {prospect.keywords && prospect.keywords.length > 0 && (
            <div>
              <h4 className="text-purple-200 font-semibold mb-2">Keywords</h4>
              <div className="flex flex-wrap gap-2">
                {prospect.keywords.map((keyword, index) => (
                  <span 
                    key={index}
                    className="px-3 py-1 bg-purple-600/20 text-purple-300 rounded-full text-sm"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}