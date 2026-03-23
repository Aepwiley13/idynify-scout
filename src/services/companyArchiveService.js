/**
 * companyArchiveService.js — Shared archive/restore logic for companies.
 *
 * Centralises the cascade: when a company is archived every associated contact
 * gets `company_archived: true` so they drop out of active People views.
 * Restoring reverses the cascade.
 */
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/config';

/**
 * Archive a company and cascade the flag to all its contacts.
 * @param {string} userId  – Firestore user id
 * @param {string} companyId – Firestore company doc id
 */
export async function archiveCompanyWithCascade(userId, companyId) {
  const now = new Date().toISOString();

  // 1. Archive the company document
  await updateDoc(doc(db, 'users', userId, 'companies', companyId), {
    status: 'archived',
    archived_at: now,
    activity_log: arrayUnion({ type: 'status_changed', from: 'accepted', to: 'archived', timestamp: now }),
  });

  // 2. Cascade: flag every contact that belongs to this company
  const contactsSnap = await getDocs(
    query(collection(db, 'users', userId, 'contacts'), where('company_id', '==', companyId))
  );
  if (!contactsSnap.empty) {
    const batch = writeBatch(db);
    contactsSnap.docs.forEach(d => {
      batch.update(d.ref, { company_archived: true, company_archived_at: now });
    });
    await batch.commit();
  }
}

/**
 * Restore a company and clear the cascade flag from all its contacts.
 * @param {string} userId  – Firestore user id
 * @param {string} companyId – Firestore company doc id
 */
export async function restoreCompanyWithCascade(userId, companyId) {
  const now = new Date().toISOString();

  // 1. Restore the company document
  await updateDoc(doc(db, 'users', userId, 'companies', companyId), {
    status: 'accepted',
    archived_at: null,
    activity_log: arrayUnion({ type: 'status_changed', from: 'archived', to: 'accepted', timestamp: now }),
  });

  // 2. Un-cascade: clear company_archived flag on associated contacts
  const contactsSnap = await getDocs(
    query(collection(db, 'users', userId, 'contacts'), where('company_id', '==', companyId))
  );
  if (!contactsSnap.empty) {
    const batch = writeBatch(db);
    contactsSnap.docs.forEach(d => {
      batch.update(d.ref, { company_archived: false, company_archived_at: null });
    });
    await batch.commit();
  }
}
