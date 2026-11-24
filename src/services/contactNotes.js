import { arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export async function appendContactNote(uid, contactId, note) {
  await updateDoc(doc(db, 'users', uid, 'contacts', contactId), {
    notes: arrayUnion(note),
    activity_log: arrayUnion({ type: 'note_added', timestamp: note.created_at, details: 'Added a note' }),
  });
}
