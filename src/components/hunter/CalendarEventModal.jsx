import { useState } from 'react';
import { auth } from '../../firebase/config';
import { Calendar, Clock, MapPin, X, Loader, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react';

const DURATIONS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '1 hour', minutes: 60 },
  { label: '90 min', minutes: 90 },
  { label: '2 hours', minutes: 120 },
];

/**
 * Modal to schedule a meeting with a contact via Google Calendar.
 *
 * Props:
 *  contact       — contact object (firstName, lastName, email, company_name)
 *  calendarEmail — connected Google Calendar email
 *  onClose       — close callback
 *  onSuccess     — called with { eventId, eventLink, title, startDateTime }
 */
export default function CalendarEventModal({ contact, calendarEmail, onClose, onSuccess }) {
  const contactName = `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim() || 'Contact';

  // Default start = tomorrow at 10:00am
  const defaultStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    // Format for datetime-local input: "YYYY-MM-DDTHH:MM"
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const [title, setTitle] = useState(`Meeting with ${contactName}`);
  const [startInput, setStartInput] = useState(defaultStart);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  function computeEndDateTime(start, durationMins) {
    if (!start) return '';
    const startMs = new Date(start).getTime();
    if (isNaN(startMs)) return '';
    const endMs = startMs + durationMins * 60 * 1000;
    const end = new Date(endMs);
    const pad = n => String(n).padStart(2, '0');
    return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }

  async function handleSchedule() {
    if (!title.trim()) {
      setError('Meeting title is required.');
      return;
    }
    if (!startInput) {
      setError('Start date/time is required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      const authToken = await user.getIdToken();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Convert datetime-local value to full ISO 8601
      const startISO = new Date(startInput).toISOString();
      const endISO = new Date(computeEndDateTime(startInput, durationMinutes)).toISOString();

      const response = await fetch('/.netlify/functions/calendar-create-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          title: title.trim(),
          description: description.trim(),
          startDateTime: startISO,
          endDateTime: endISO,
          timeZone,
          attendeeEmail: contact?.email || null,
          attendeeName: contactName,
          contactId: contact?.id || null,
          location: location.trim()
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create event');
      }

      setSuccess(data);
      onSuccess?.(data);

    } catch (err) {
      console.error('CalendarEventModal error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 border border-green-500/30 rounded-xl p-6 max-w-md w-full shadow-2xl">
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle className="w-12 h-12 text-green-400" />
            <h2 className="text-xl font-bold text-white">Meeting Scheduled!</h2>
            <p className="text-gray-400">
              <span className="text-white font-medium">{success.title}</span> has been added to your Google Calendar
              {contact?.email && <span> and an invite was sent to {contact.email}</span>}.
            </p>
            <div className="flex gap-3 w-full mt-2">
              <a
                href={success.eventLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
              >
                <ExternalLink className="w-4 h-4" />
                Open in Calendar
              </a>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold text-white">Schedule Meeting</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Connected as */}
        {calendarEmail && (
          <div className="mb-4 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-400 flex items-center gap-2">
            <Calendar className="w-3 h-3" />
            Scheduling via {calendarEmail}
          </div>
        )}

        {/* Contact */}
        <div className="mb-4 px-3 py-2 bg-gray-800 rounded-lg text-sm text-gray-300">
          <span className="text-gray-500">With: </span>
          <span className="font-medium text-white">{contactName}</span>
          {contact?.email && <span className="text-gray-400 ml-2">({contact.email})</span>}
          {contact?.company_name && <span className="text-gray-500"> · {contact.company_name}</span>}
          {contact?.email && (
            <span className="ml-2 text-xs text-green-400">Invite will be sent</span>
          )}
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Meeting Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder="e.g. Intro call with John"
            />
          </div>

          {/* Date & Time */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" /> Start Date & Time
            </label>
            <input
              type="datetime-local"
              value={startInput}
              onChange={e => setStartInput(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Duration</label>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map(d => (
                <button
                  key={d.minutes}
                  onClick={() => setDurationMinutes(d.minutes)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    durationMinutes === d.minutes
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Location (optional)
            </label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder="e.g. Zoom, Google Meet, or address"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-gray-400 mb-1 font-medium">Notes / Agenda (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
              placeholder="What will you cover in this meeting?"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSchedule}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-bold"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Scheduling...
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4" />
                Schedule Meeting
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
