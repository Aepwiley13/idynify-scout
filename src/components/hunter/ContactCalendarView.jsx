import { useState, useEffect } from 'react';
import { auth } from '../../firebase/config';
import { Calendar, Clock, MapPin, Users, ExternalLink, Loader, AlertCircle, CalendarDays, Plus } from 'lucide-react';
import CalendarEventModal from './CalendarEventModal';

const STATUS_COLORS = {
  accepted: 'text-green-400',
  declined: 'text-red-400',
  tentative: 'text-yellow-400',
  needsAction: 'text-gray-400'
};

function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return isoString;
  }
}

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
  } catch {
    return isoString;
  }
}

function isUpcoming(startDateTime) {
  return startDateTime && new Date(startDateTime) > new Date();
}

/**
 * ContactCalendarView — shows upcoming calendar events with a specific contact.
 *
 * Props:
 *  contact             — contact object
 *  calendarConnected   — boolean
 *  calendarEmail       — string (connected email)
 */
export default function ContactCalendarView({ contact, calendarConnected, calendarEmail }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (calendarConnected && contact?.email) {
      loadEvents();
    }
  }, [calendarConnected, contact?.email]);

  async function loadEvents() {
    setLoading(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) return;

      const authToken = await user.getIdToken();

      const response = await fetch('/.netlify/functions/calendar-list-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.uid,
          authToken,
          contactEmail: contact.email,
          // Look 60 days out
          timeMax: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
        })
      });

      const data = await response.json();

      if (data.code === 'CALENDAR_NOT_CONNECTED' || data.code === 'NEEDS_RECONNECT') {
        setError('Calendar session expired — please reconnect Google Calendar.');
        return;
      }

      if (!response.ok) throw new Error(data.error || 'Failed to load events');

      setEvents(data.events || []);
    } catch (err) {
      console.error('[ContactCalendarView] error:', err);
      setError('Could not load calendar events.');
    } finally {
      setLoading(false);
    }
  }

  function handleScheduleSuccess(eventData) {
    setShowModal(false);
    // Add optimistic event to list
    setEvents(prev => [{
      id: eventData.eventId,
      title: eventData.title,
      startDateTime: eventData.startDateTime,
      endDateTime: eventData.endDateTime,
      htmlLink: eventData.eventLink,
      attendees: contact?.email ? [{ email: contact.email, name: contact.firstName, status: 'needsAction' }] : [],
      status: 'confirmed'
    }, ...prev]);
  }

  if (!calendarConnected) {
    return (
      <div className="px-4 py-3 bg-gray-800/50 rounded-lg text-sm text-gray-500 flex items-center gap-2">
        <Calendar className="w-4 h-4 flex-shrink-0" />
        Connect Google Calendar in Settings to schedule meetings and see upcoming events.
      </div>
    );
  }

  if (!contact?.email) {
    return (
      <div className="px-4 py-3 bg-gray-800/50 rounded-lg text-sm text-gray-500 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        No email address on file — add an email to see calendar events with this contact.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
            <CalendarDays className="w-4 h-4 text-blue-400" />
            Meetings with {contact.firstName || 'Contact'}
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Plus className="w-3 h-3" />
            Schedule
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
            <Loader className="w-4 h-4 animate-spin" />
            Loading events...
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* Events list */}
        {!loading && !error && events.length === 0 && (
          <div className="px-3 py-3 bg-gray-800/50 rounded-lg text-sm text-gray-500 text-center">
            No upcoming meetings found with {contact.email}.
            <br />
            <button
              onClick={() => setShowModal(true)}
              className="mt-2 text-blue-400 hover:text-blue-300 underline text-xs"
            >
              Schedule one now
            </button>
          </div>
        )}

        {!loading && events.map(event => (
          <div
            key={event.id}
            className={`p-3 rounded-lg border ${
              isUpcoming(event.startDateTime)
                ? 'bg-blue-500/5 border-blue-500/20'
                : 'bg-gray-800/50 border-gray-700/50 opacity-70'
            }`}
          >
            {/* Title row */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Calendar className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isUpcoming(event.startDateTime) ? 'text-blue-400' : 'text-gray-500'}`} />
                <span className="text-sm font-medium text-white">{event.title}</span>
              </div>
              {event.htmlLink && (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-blue-400 flex-shrink-0 transition-colors"
                  title="Open in Google Calendar"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            {/* Date/time */}
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-400 ml-6">
              <Clock className="w-3 h-3" />
              {event.isAllDay ? formatDate(event.startDateTime) : formatDateTime(event.startDateTime)}
              {!event.isAllDay && event.endDateTime && (
                <span className="text-gray-600">
                  — {new Date(event.endDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </span>
              )}
            </div>

            {/* Location */}
            {event.location && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 ml-6">
                <MapPin className="w-3 h-3" />
                {event.location}
              </div>
            )}

            {/* Attendees */}
            {event.attendees && event.attendees.length > 0 && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 ml-6 flex-wrap">
                <Users className="w-3 h-3 flex-shrink-0" />
                {event.attendees.slice(0, 3).map((a, i) => (
                  <span key={i} className={`${STATUS_COLORS[a.status] || 'text-gray-400'}`}>
                    {a.name || a.email}
                    {a.status === 'accepted' && ' ✓'}
                    {a.status === 'declined' && ' ✗'}
                    {i < Math.min(event.attendees.length, 3) - 1 && <span className="text-gray-600">, </span>}
                  </span>
                ))}
                {event.attendees.length > 3 && (
                  <span className="text-gray-600">+{event.attendees.length - 3} more</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Schedule Meeting Modal */}
      {showModal && (
        <CalendarEventModal
          contact={contact}
          calendarEmail={calendarEmail}
          onClose={() => setShowModal(false)}
          onSuccess={handleScheduleSuccess}
        />
      )}
    </>
  );
}
