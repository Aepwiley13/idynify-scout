// Admin SDK writes bypass Firestore rules. Read the contact in the same
// transaction as the child write so a committed deletion invalidates it.
export async function withExistingContact(db, contact, write) {
  return db.runTransaction(async (tx) => {
    if (!(await tx.get(contact)).exists) return null;
    return write(tx);
  });
}

export async function appendContactChild(db, contact, collection, data) {
  const child = contact.collection(collection).doc();
  return withExistingContact(db, contact, (tx) => {
    tx.set(child, data);
    return child;
  });
}

export const deletedContactRef = (db, uid, id) => db.doc(`contact_hub_deleted/${uid}/contacts/${id}`);
