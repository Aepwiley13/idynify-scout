// Admin SDK writes bypass Firestore rules. Read the contact in the same
// transaction as the child write so a committed deletion invalidates it.
export const isWritableContact = (snap) => snap.exists && snap.data?.()?.contact_hub_lifecycle?.status !== 'retired';

export async function withExistingContact(db, contact, write) {
  return db.runTransaction(async (tx) => {
    if (!isWritableContact(await tx.get(contact))) return null;
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

export const retiredContactRef = (db, uid, id) => db.doc(`contact_hub_retired/${uid}/contacts/${id}`);
