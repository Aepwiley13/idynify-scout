# Hunter Module - Firestore Security Rules

## Required Firestore Security Rules for Hunter

Add these rules to your Firestore Security Rules in the Firebase Console.

Navigate to: **Firebase Console → Firestore Database → Rules**

---

## Rules to Add

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ... (keep all your existing rules)

    // ==============================
    // HUNTER MODULE RULES
    // ==============================

    // Campaigns collection
    // Users can read/write their own campaigns
    match /users/{userId}/campaigns/{campaignId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Gmail Integration
    // Users can read/write their own Gmail integration data
    match /users/{userId}/integrations/gmail {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // ==============================
    // END HUNTER MODULE RULES
    // ==============================
  }
}
```

---

## Where to Add These Rules

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **idynify-scout-dev**
3. Navigate to **Firestore Database** → **Rules**
4. Add the Hunter rules above to your existing rules
5. Click **Publish** to save

---

## Important Notes

- ✅ These rules ensure users can ONLY access their own campaigns and Gmail integrations
- ✅ Authentication is required for all Hunter operations
- ✅ No user can read or modify another user's Hunter data
- ⚠️  Do NOT remove existing rules - only ADD the Hunter rules
- ⚠️  Make sure to keep the `rules_version = '2';` line at the top

---

## Example: Complete Firestore Rules File

Here's an example of what your complete rules file might look like:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users collection
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // Companies subcollection
      match /companies/{companyId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      // Contacts subcollection
      match /contacts/{contactId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      // HUNTER: Campaigns subcollection
      match /campaigns/{campaignId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      // HUNTER: Gmail integration
      match /integrations/gmail {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Dashboards collection (for RECON)
    match /dashboards/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Add any other existing rules here...
  }
}
```

---

## Testing the Rules

After publishing the rules, test them by:

1. Creating a campaign in Hunter
2. Connecting Gmail
3. Sending a test email
4. Verifying data is saved to Firestore

If you encounter permission errors, double-check:
- Rules are published (not just saved as draft)
- User is authenticated (logged in)
- userId in the path matches the authenticated user's UID

---

## Security Best Practices ✅

These rules follow security best practices:

- ✅ **Authentication Required**: All operations require authentication
- ✅ **User Isolation**: Users can only access their own data
- ✅ **No Admin Backdoor**: Even admins must authenticate properly
- ✅ **Granular Access**: Rules are specific to each collection
- ✅ **Read = Write Symmetry**: If a user can write, they can read (prevents orphaned data)

---

## Troubleshooting

### Error: "Missing or insufficient permissions"

**Cause**: Firestore rules are not published or incorrect

**Solution**:
1. Check Firebase Console → Firestore → Rules
2. Verify Hunter rules are present
3. Click **Publish** (not just Save)
4. Wait 1-2 minutes for propagation
5. Refresh your browser

### Error: "PERMISSION_DENIED"

**Cause**: User is not authenticated or accessing another user's data

**Solution**:
1. Verify user is logged in (`auth.currentUser` is not null)
2. Check the userId in the Firestore path matches the authenticated user's UID
3. Verify authToken is valid

---

## Need Help?

If you encounter issues:
1. Check the browser console for detailed error messages
2. Verify the Firebase project is `idynify-scout-dev`
3. Ensure you're testing with a logged-in user
4. Check that the rules are published (not draft)

---

**Last Updated**: 2026-01-15
**Hunter MVP Version**: 1.0
**Firebase Project**: idynify-scout-dev
