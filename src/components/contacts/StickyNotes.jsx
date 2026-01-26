import React, { useState } from 'react';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { Trash2, Edit2, Check, X, StickyNote as StickyNoteIcon } from 'lucide-react';
import './StickyNotes.css';

export default function StickyNotes({ contact, onUpdate }) {
  const [notes, setNotes] = useState(contact.notes || []);
  const [isAdding, setIsAdding] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  // Auto-linkify URLs in text
  const linkifyText = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="note-link"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const handleAddNote = async () => {
    if (!newNoteText.trim()) return;

    try {
      const user = auth.currentUser;
      if (!user) return;

      const note = {
        id: Date.now().toString(),
        content: newNoteText.trim(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Update Firestore
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        notes: arrayUnion(note),
        activity_log: arrayUnion({
          type: 'note_added',
          timestamp: new Date().toISOString(),
          details: 'Added a note'
        })
      });

      // Update local state
      setNotes([...notes, note]);
      setNewNoteText('');
      setIsAdding(false);

      if (onUpdate) {
        onUpdate({ ...contact, notes: [...notes, note] });
      }

      console.log('✅ Note added successfully');
    } catch (error) {
      console.error('❌ Failed to add note:', error);
    }
  };

  const handleEditNote = async (noteId) => {
    if (!editText.trim()) return;

    try {
      const user = auth.currentUser;
      if (!user) return;

      const updatedNotes = notes.map(note =>
        note.id === noteId
          ? { ...note, content: editText.trim(), updated_at: new Date().toISOString() }
          : note
      );

      // Update Firestore
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        notes: updatedNotes,
        activity_log: arrayUnion({
          type: 'note_edited',
          timestamp: new Date().toISOString(),
          details: 'Edited a note'
        })
      });

      // Update local state
      setNotes(updatedNotes);
      setEditingId(null);
      setEditText('');

      if (onUpdate) {
        onUpdate({ ...contact, notes: updatedNotes });
      }

      console.log('✅ Note updated successfully');
    } catch (error) {
      console.error('❌ Failed to update note:', error);
    }
  };

  const handleDeleteNote = async (noteToDelete) => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const updatedNotes = notes.filter(note => note.id !== noteToDelete.id);

      // Update Firestore
      const contactRef = doc(db, 'users', user.uid, 'contacts', contact.id);
      await updateDoc(contactRef, {
        notes: updatedNotes,
        activity_log: arrayUnion({
          type: 'note_deleted',
          timestamp: new Date().toISOString(),
          details: 'Deleted a note'
        })
      });

      // Update local state
      setNotes(updatedNotes);

      if (onUpdate) {
        onUpdate({ ...contact, notes: updatedNotes });
      }

      console.log('✅ Note deleted successfully');
    } catch (error) {
      console.error('❌ Failed to delete note:', error);
    }
  };

  const startEditing = (note) => {
    setEditingId(note.id);
    setEditText(note.content);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditText('');
  };

  return (
    <div className="sticky-notes-section">
      <div className="sticky-notes-header">
        <h3>
          <StickyNoteIcon className="w-4 h-4" />
          Notes
        </h3>
        {!isAdding && (
          <button
            className="btn-add-note"
            onClick={() => setIsAdding(true)}
          >
            + Add Note
          </button>
        )}
      </div>

      {/* Add New Note */}
      {isAdding && (
        <div className="sticky-note new-note">
          <textarea
            className="note-textarea"
            placeholder="Write a quick note... (paste links, copy text, etc.)"
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            autoFocus
            rows={4}
          />
          <div className="note-actions">
            <button className="btn-save" onClick={handleAddNote}>
              <Check className="w-4 h-4" />
              Save
            </button>
            <button className="btn-cancel" onClick={() => {
              setIsAdding(false);
              setNewNoteText('');
            }}>
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Display Notes */}
      {notes.length === 0 && !isAdding && (
        <div className="no-notes">
          <StickyNoteIcon className="w-12 h-12" />
          <p>No notes yet. Click "Add Note" to create your first sticky note!</p>
        </div>
      )}

      <div className="sticky-notes-grid">
        {notes.map((note) => (
          <div key={note.id} className="sticky-note">
            {editingId === note.id ? (
              <>
                <textarea
                  className="note-textarea"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  autoFocus
                  rows={4}
                />
                <div className="note-actions">
                  <button className="btn-save" onClick={() => handleEditNote(note.id)}>
                    <Check className="w-4 h-4" />
                    Save
                  </button>
                  <button className="btn-cancel" onClick={cancelEditing}>
                    <X className="w-4 h-4" />
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="note-content">
                  {linkifyText(note.content)}
                </div>
                <div className="note-footer">
                  <span className="note-date">
                    {new Date(note.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </span>
                  <div className="note-actions">
                    <button
                      className="btn-icon"
                      onClick={() => startEditing(note)}
                      title="Edit note"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="btn-icon btn-delete"
                      onClick={() => handleDeleteNote(note)}
                      title="Delete note"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
