# Firebase Functions for Idynify Scout Admin Dashboard

This directory contains Firebase Cloud Functions for the Idynify Scout platform. These functions handle admin-only operations that require elevated permissions.

## 🏗️ Architecture

**Decision**: Admin dashboard logic runs on Firebase Functions (not Netlify Functions)

**Why**:
- Firebase Admin SDK requires default service account credentials
- Organization policy blocks service account JSON key creation
- Firebase Functions automatically provide default credentials
- No key management overhead
- Production-grade, compliant architecture

## 📋 Prerequisites

1. **Firebase CLI** installed:
   ```bash
   npm install -g firebase-tools
   ```

2. **Firebase project** initialized:
   ```bash
   firebase login
   firebase use idynify-mission-control
   ```

3. **Node.js 20** (specified in package.json engines)

## 🚀 Deployment

### Step 1: Install Dependencies

```bash
cd functions
npm install
```

### Step 2: Set Environment Variables (Optional)

For bootstrap admin access, set ADMIN_USER_IDS:

**Method 1: Firebase CLI**
```bash
firebase functions:config:set admin.user_ids="uid1,uid2,uid3"
```

**Method 2: Google Cloud Console**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to Cloud Functions
3. Select your function
4. Click "Edit" → "Runtime, build, connections and security settings"
5. Add environment variable:
   - Name: `ADMIN_USER_IDS`
   - Value: `uid1,uid2,uid3` (comma-separated UIDs)

**Note**: The preferred method is setting `role: 'admin'` in Firestore `users/{uid}` document.

### Step 3: Deploy Functions

**Deploy all functions:**
```bash
firebase deploy --only functions
```

**Deploy specific function:**
```bash
firebase deploy --only functions:adminGetUsers
```

**Deploy with debug logging:**
```bash
firebase deploy --only functions --debug
```

### Step 4: Verify Deployment

After deployment, you'll see the function URL:
```
Function URL (adminGetUsers): https://us-central1-idynify-mission-control.cloudfunctions.net/adminGetUsers
```

Update your `.env` file:
```
VITE_ADMIN_API_BASE=https://us-central1-idynify-mission-control.cloudfunctions.net
```

## 🧪 Local Development & Testing

### Run Firebase Emulator

```bash
# Start emulator
firebase emulators:start --only functions

# Emulator URL
http://127.0.0.1:5001/idynify-mission-control/us-central1/adminGetUsers
```

### Configure Frontend for Local Development

Update `.env.local`:
```
VITE_ADMIN_API_BASE=http://127.0.0.1:5001/idynify-mission-control/us-central1
```

### Test Function Locally

Using curl:
```bash
curl -X POST http://127.0.0.1:5001/idynify-mission-control/us-central1/adminGetUsers \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_USER_ID",
    "authToken": "YOUR_AUTH_TOKEN"
  }'
```

## 📊 Available Functions

### `adminGetUsers`

**Description**: Fetches all users with aggregated data from Firestore

**Endpoint**: `POST /adminGetUsers`

**Request Body**:
```json
{
  "userId": "string (required)",
  "authToken": "string (required)",
  "limit": "number (optional, for pagination)",
  "cursor": "string (optional, for pagination)"
}
```

**Response**:
```json
{
  "success": true,
  "users": [...],
  "platformStats": {
    "totalUsers": 0,
    "activeUsers": 0,
    "totalCredits": 0,
    "totalCompanies": 0,
    "totalContacts": 0
  },
  "totalUsers": 0,
  "errors": []
}
```

**Authentication**:
- Verifies Firebase Auth token
- Checks admin access via:
  1. `ADMIN_USER_IDS` environment variable (bootstrap)
  2. Firestore `users/{uid}/role === 'admin'` (preferred)

**CORS**:
- Allows: `https://*.idynify.com`, `https://idynify.com`, `http://localhost:*`

## 🔒 Admin Access Setup

### Method 1: Firestore Role (Recommended)

1. Go to Firebase Console → Firestore Database
2. Navigate to `users/{uid}` for your admin user
3. Add field:
   - **Field**: `role`
   - **Type**: `string`
   - **Value**: `admin`

### Method 2: Environment Variable (Bootstrap)

Set `ADMIN_USER_IDS` with comma-separated UIDs:

```bash
firebase functions:config:set admin.user_ids="7g5gbYiwLOdIRdCTtogZ7Wn3hG23"
firebase deploy --only functions
```

## 📝 Logs & Monitoring

### View Function Logs

**Recent logs:**
```bash
firebase functions:log
```

**Specific function:**
```bash
firebase functions:log --only adminGetUsers
```

**Follow logs (tail):**
```bash
firebase functions:log --follow
```

### Google Cloud Console Logs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to "Cloud Functions"
3. Click on function name
4. Click "Logs" tab

### Log Structure

All admin function calls log:
```
{
  function: 'adminGetUsers',
  callerUid: 'user_id',
  timestamp: '2025-01-05T00:00:00.000Z',
  hasPagination: false
}
```

## 🛠️ Troubleshooting

### Issue: "Could not load default credentials"

**Solution**: This should NOT happen with Firebase Functions. If it does:
1. Verify you're deploying to Firebase Functions (not Netlify)
2. Check that `firebase-admin` is properly initialized
3. Ensure you're using `firebase deploy` command

### Issue: "CORS error"

**Solution**: Function is configured for:
- `https://*.idynify.com`
- `https://idynify.com`
- `http://localhost:*`

If using a different domain, update CORS config in `admin-get-users.js`.

### Issue: "Unauthorized - Admin access required"

**Solution**:
1. Verify `role: 'admin'` exists in Firestore `users/{uid}` document
2. OR verify UID is in `ADMIN_USER_IDS` environment variable
3. Check function logs: `firebase functions:log --only adminGetUsers`

### Issue: Frontend can't connect to function

**Solution**:
1. Verify `VITE_ADMIN_API_BASE` is set in `.env` file
2. For production: `https://us-central1-idynify-mission-control.cloudfunctions.net`
3. For emulator: `http://127.0.0.1:5001/idynify-mission-control/us-central1`
4. Rebuild frontend: `npm run build`

## 📦 Function Configuration

**Region**: `us-central1`
**Runtime**: Node.js 20
**Memory**: 512 MiB
**Timeout**: 540 seconds (9 minutes)
**Max Instances**: 10

## 🚀 CI/CD Integration

### GitHub Actions Example

```yaml
- name: Deploy Firebase Functions
  run: |
    cd functions
    npm install
    firebase deploy --only functions --token ${{ secrets.FIREBASE_TOKEN }}
```

### Get Firebase Token

```bash
firebase login:ci
```

Store token in GitHub Secrets as `FIREBASE_TOKEN`.

## 📚 Additional Resources

- [Firebase Functions Documentation](https://firebase.google.com/docs/functions)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [Cloud Functions Pricing](https://firebase.google.com/pricing)

## 🔄 Migration Notes

### Deprecated: Netlify `admin-get-users` Function

The original Netlify function at `netlify/functions/admin-get-users.js` is **deprecated** and should not be used. All admin logic has been moved to Firebase Functions.

**Why**:
- Firebase Functions have access to default service account credentials
- No need for service account JSON keys
- Cleaner, more secure architecture
- Better integration with Firebase services

**Action Required**:
- Update `.env` file with new `VITE_ADMIN_API_BASE`
- Deploy Firebase Functions
- Old Netlify function can be removed or kept for reference
