// Module 2: Test script for Firestore schema
// This file can be imported and called to test document creation

import { db } from './config';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { getPath } from './schema';
import { DEFAULT_WEIGHTS } from '../constants/weights';

/**
 * Test function to verify Firestore schema works
 * Creates a test document with default weights for a user
 *
 * @param {string} userId - The user ID to test with
 * @returns {Promise<boolean>} - Returns true if test succeeds
 */
export async function testFirestoreSchema(userId) {
  try {
    // Test 1: Create a test weights document
    const weightsPath = getPath.userWeightsCurrent(userId);
    const weightsRef = doc(db, weightsPath);

    await setDoc(weightsRef, {
      ...DEFAULT_WEIGHTS,
      created_at: new Date().toISOString(),
      test: true
    });

    // Test 2: Read it back
    const weightsDoc = await getDoc(weightsRef);

    if (!weightsDoc.exists()) {
      console.error('Test failed: Document was not created');
      return false;
    }

    const data = weightsDoc.data();
    console.log('Test successful: Document created and retrieved', data);

    // Verify default weights are correct
    if (
      data.title_match_weight === DEFAULT_WEIGHTS.title_match_weight &&
      data.industry_match_weight === DEFAULT_WEIGHTS.industry_match_weight &&
      data.company_size_weight === DEFAULT_WEIGHTS.company_size_weight
    ) {
      console.log('Default weights verified correctly');
      return true;
    } else {
      console.error('Default weights do not match');
      return false;
    }
  } catch (error) {
    console.error('Firestore test error:', error);
    return false;
  }
}
