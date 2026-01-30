# Recon Authentication & Authorization — Fix Implementation Report

**Date:** 2026-01-30
**Branch:** `claude/recon-evaluation-V30zU`
**Fixes Applied:** AUTH-01 through AUTH-08

---

## Issue: AUTH-04 — `/admin-ping-test` Is Unprotected (HIGH)

### 1. Problem Description

The route `/admin-ping-test` rendered `<AdminPingTest />` with zero authentication or authorization guards. Any unauthenticated visitor could access the page, which exposes the admin API base URL (`VITE_ADMIN_API_BASE`) and backend connectivity status. This aids reconnaissance by an attacker.

**Location:** `src/App.jsx:446`

**Before:**
```jsx
<Route path="/admin-ping-test" element={<AdminPingTest />} />
```

### 2. Proposed Fix

Wrapped the route with `<ProtectedAdminRoute>`, which verifies both authentication (Firebase Auth) and admin role (Firestore `role === 'admin'`).

**After (`src/App.jsx:446-453`):**
```jsx
<Route
  path="/admin-ping-test"
  element={
    <ProtectedAdminRoute>
      <AdminPingTest />
    </ProtectedAdminRoute>
  }
/>
```

### 3. Automated Tests

```javascript
// test/auth/admin-ping-test-protection.test.js
describe('AUTH-04: /admin-ping-test route protection', () => {
  it('should redirect unauthenticated users to /login', async () => {
    // Navigate to /admin-ping-test without signing in
    render(<App />, { route: '/admin-ping-test' });
    expect(screen.getByText('Verifying admin access...')).toBeInTheDocument();
    // After loading, should redirect to /login
    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
  });

  it('should show Access Denied for non-admin authenticated users', async () => {
    // Sign in as regular user
    await signInWithEmailAndPassword(auth, 'user@test.com', 'password');
    render(<App />, { route: '/admin-ping-test' });
    await waitFor(() => {
      expect(screen.getByText('Access Denied')).toBeInTheDocument();
    });
  });

  it('should render AdminPingTest for admin users', async () => {
    // Sign in as admin user (role === 'admin' in Firestore)
    await signInWithEmailAndPassword(auth, 'admin@test.com', 'password');
    render(<App />, { route: '/admin-ping-test' });
    await waitFor(() => {
      expect(screen.getByText(/ping/i)).toBeInTheDocument();
    });
  });
});
```

### 4. Manual QA Steps

1. Open an incognito browser window.
2. Navigate directly to `https://idynify.com/admin-ping-test`.
3. **Expected:** Redirect to `/login` page.
4. Log in as a regular (non-admin) user.
5. Navigate to `/admin-ping-test`.
6. **Expected:** "Access Denied" page is displayed.
7. Log in as an admin user.
8. Navigate to `/admin-ping-test`.
9. **Expected:** AdminPingTest page loads successfully.

### 5. Pass/Fail Criteria

- [ ] Unauthenticated users cannot see the page (redirect to `/login`)
- [ ] Non-admin users see "Access Denied"
- [ ] Admin users can access the page normally

### 6. Risks & Notes

- **Backward compatibility:** No impact. The page was never intended to be public.
- **Rollback:** Revert the single line in `App.jsx` to restore the old behavior.

---

## Issue: AUTH-06 — Firestore Rules Expose All User Data (HIGH)

### 1. Problem Description

Firestore security rules allowed any authenticated user to read any other user's document and all subcollections (companies, contacts, leads, etc.). The rule `allow read: if request.auth != null` on `/users/{userId}` meant a malicious user could enumerate all user data using the Firestore client SDK directly.

**Location:** `firestore.rules:7,13`

**Before:**
```
match /users/{userId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.uid == userId;
}
match /users/{userId}/{document=**} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.uid == userId;
}
```

### 2. Proposed Fix

Changed read rules to scope access to the document owner only. Admin reads are handled server-side via the Firebase Admin SDK, which bypasses Firestore rules entirely.

**After (`firestore.rules`):**
```
match /users/{userId} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if request.auth != null && request.auth.uid == userId;
}
match /users/{userId}/{document=**} {
  allow read: if request.auth != null && request.auth.uid == userId;
  allow write: if request.auth != null && request.auth.uid == userId;
}
```

Also added an explicit deny rule for `impersonationSessions`:
```
match /impersonationSessions/{sessionId} {
  allow read, write: if false;
}
```

### 3. Automated Tests

```javascript
// test/firestore/rules.test.js (using @firebase/rules-unit-testing)
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');

describe('AUTH-06: Firestore security rules', () => {
  let testEnv;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'test-project',
      firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') }
    });
  });

  it('should allow a user to read their own document', async () => {
    const userA = testEnv.authenticatedContext('user-a');
    const db = userA.firestore();
    await assertSucceeds(db.doc('users/user-a').get());
  });

  it('should deny User A from reading User B document', async () => {
    const userA = testEnv.authenticatedContext('user-a');
    const db = userA.firestore();
    await assertFails(db.doc('users/user-b').get());
  });

  it('should deny User A from reading User B subcollection', async () => {
    const userA = testEnv.authenticatedContext('user-a');
    const db = userA.firestore();
    await assertFails(db.collection('users/user-b/companies').get());
  });

  it('should allow a user to read their own subcollection', async () => {
    const userA = testEnv.authenticatedContext('user-a');
    const db = userA.firestore();
    await assertSucceeds(db.collection('users/user-a/companies').get());
  });

  it('should deny all client access to impersonationSessions', async () => {
    const userA = testEnv.authenticatedContext('user-a');
    const db = userA.firestore();
    await assertFails(db.collection('impersonationSessions').get());
  });

  it('should deny unauthenticated access to user documents', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const db = unauthed.firestore();
    await assertFails(db.doc('users/user-a').get());
  });
});
```

### 4. Manual QA Steps

1. Log in as User A in the application.
2. Open browser DevTools > Console.
3. Run: `firebase.firestore().doc('users/<user-b-id>').get().then(d => console.log(d.data())).catch(e => console.error(e))`
4. **Expected:** Permission denied error.
5. Run: `firebase.firestore().doc('users/<user-a-id>').get().then(d => console.log(d.data()))`
6. **Expected:** User A's own document is returned.
7. Verify the admin dashboard still works (uses server-side Admin SDK).

### 5. Pass/Fail Criteria

- [ ] User A cannot read User B's document
- [ ] User A cannot read User B's subcollections
- [ ] User A can still read their own document and subcollections
- [ ] Admin dashboard still works (uses Admin SDK, bypasses rules)
- [ ] Application functions normally for regular users

### 6. Risks & Notes

- **Breaking change risk:** If any client-side code reads other users' documents directly, it will break. The application architecture uses server-side functions for cross-user reads (admin dashboard), so this should be safe.
- **Deploy command:** `firebase deploy --only firestore:rules`
- **Rollback:** Revert `firestore.rules` and redeploy.

---

## Issue: AUTH-03 — "Forgot Password" Link Broken (MEDIUM)

### 1. Problem Description

The signup page contained a "Forgot your password? Reset it here" link navigating to `/forgot-password`, but no such route existed. The catch-all redirect sent users back to the homepage silently — no password reset was possible.

**Location:** `src/pages/Signup.jsx:304`

### 2. Proposed Fix

1. **Created `src/pages/ForgotPassword.jsx`** — A complete password reset page using Firebase's `sendPasswordResetEmail()` API. Features:
   - Email input with validation
   - User-friendly error messages (maps Firebase error codes)
   - Success state with confirmation message
   - Back-to-login navigation
   - Consistent visual design (starfield theme)

2. **Registered the route in `App.jsx`:**
   ```jsx
   <Route path="/forgot-password" element={!user ? <ForgotPassword /> : <Navigate to="/mission-control-v2" />} />
   ```

3. **Added forgot-password link to Login page** (was only on Signup).

4. **Fixed AUTH-02 (bonus):** Replaced raw Firebase error rendering in `Signup.jsx` with a `switch` statement mapping `error.code` to user-friendly messages.

### 3. Automated Tests

```javascript
describe('AUTH-03: Forgot Password flow', () => {
  it('should render the forgot password page at /forgot-password', () => {
    render(<App />, { route: '/forgot-password' });
    expect(screen.getByText('Reset Password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
  });

  it('should show success message after submitting valid email', async () => {
    render(<ForgotPassword />);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'test@test.com' } });
    fireEvent.click(screen.getByText(/Send Reset Email/i));
    await waitFor(() => {
      expect(screen.getByText(/Password reset email sent/i)).toBeInTheDocument();
    });
  });

  it('should show error for invalid email', async () => {
    // Mock sendPasswordResetEmail to throw auth/invalid-email
    render(<ForgotPassword />);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByText(/Send Reset Email/i));
    await waitFor(() => {
      expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    });
  });

  it('should redirect authenticated users away from /forgot-password', () => {
    // Sign in first
    render(<App />, { route: '/forgot-password', user: mockUser });
    expect(window.location.pathname).toBe('/mission-control-v2');
  });
});
```

### 4. Manual QA Steps

1. Navigate to `/forgot-password` while logged out.
2. **Expected:** Reset password form appears.
3. Enter a valid registered email and submit.
4. **Expected:** Success message: "Password reset email sent."
5. Check email inbox for reset link.
6. Enter a non-existent email.
7. **Expected:** User-friendly error: "No account found with this email address."
8. Click "Login here" link.
9. **Expected:** Navigate to `/login`.
10. On login page, verify "Reset it here" link works.
11. On signup page, verify "Reset it here" link works.

### 5. Pass/Fail Criteria

- [ ] `/forgot-password` renders the reset form
- [ ] Valid email triggers Firebase `sendPasswordResetEmail`
- [ ] Success message displayed after submission
- [ ] Error messages are user-friendly (no raw Firebase errors)
- [ ] Authenticated users are redirected away
- [ ] Links from both Login and Signup pages work

### 6. Risks & Notes

- **New file:** `src/pages/ForgotPassword.jsx` — no existing code affected.
- **Backward compatibility:** Full — adds a new route, existing routes unchanged.

---

## Issue: AUTH-05 — Admin Suspend Guard Uses Broken Check (MEDIUM)

### 1. Problem Description

The `adminSuspendAccount.js` function checked `targetUser.customClaims.admin === true` to prevent suspending another admin. However, the application never sets Firebase custom claims — admin status is determined by the Firestore `users/{uid}/role` field. The custom claims check was a no-op, meaning one admin **could** suspend another admin.

**Location:** `netlify/functions/adminSuspendAccount.js:131-133`

**Before:**
```javascript
const targetUserClaims = targetUser.customClaims || {};
if (targetUserClaims.admin === true) {
```

### 2. Proposed Fix

Replaced the custom claims check with the same `checkAdminAccess()` utility used everywhere else, which checks both the `ADMIN_USER_IDS` environment variable and Firestore role.

**After (`netlify/functions/adminSuspendAccount.js:131-134`):**
```javascript
// Use Firestore role check (consistent with app-wide admin determination)
const targetIsAdmin = await checkAdminAccess(targetUserId);
if (targetIsAdmin) {
```

### 3. Automated Tests

```javascript
describe('AUTH-05: Admin suspend guard', () => {
  it('should block suspending a user with role=admin in Firestore', async () => {
    // Set up: target user has role='admin' in Firestore
    const response = await callNetlifyFunction('adminSuspendAccount', {
      targetUserId: 'admin-user-id',
      reason: 'Test suspension'
    }, adminAuthToken);

    expect(response.statusCode).toBe(403);
    expect(response.body.error).toBe('Cannot suspend another admin account');
  });

  it('should block suspending a user in ADMIN_USER_IDS env var', async () => {
    // Set up: target user ID is in ADMIN_USER_IDS
    const response = await callNetlifyFunction('adminSuspendAccount', {
      targetUserId: 'env-admin-id',
      reason: 'Test suspension'
    }, adminAuthToken);

    expect(response.statusCode).toBe(403);
  });

  it('should allow suspending a regular user', async () => {
    const response = await callNetlifyFunction('adminSuspendAccount', {
      targetUserId: 'regular-user-id',
      reason: 'Policy violation'
    }, adminAuthToken);

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

### 4. Manual QA Steps

1. Log in as Admin A.
2. Navigate to Admin Dashboard > User Detail for Admin B.
3. Click "Suspend Account" with a reason.
4. **Expected:** Error: "Cannot suspend another admin account" (403).
5. Navigate to User Detail for a regular user.
6. Click "Suspend Account" with a reason.
7. **Expected:** Account suspended successfully.

### 5. Pass/Fail Criteria

- [ ] Admin cannot suspend another admin (Firestore role check)
- [ ] Admin cannot suspend a user in `ADMIN_USER_IDS` env var
- [ ] Admin can still suspend regular users
- [ ] Audit log records the blocked attempt

### 6. Risks & Notes

- **Behavioral change:** Admin-on-admin suspension was technically possible before (guard was no-op). Now it's actually blocked.
- **Backward compatibility:** If there's a legitimate need to suspend an admin, the Firestore role must be manually changed first.

---

## Issue: AUTH-07 — Auth Tokens in POST Body (MEDIUM)

### 1. Problem Description

All Netlify admin functions received the Firebase auth token as `authToken` in the JSON POST body rather than in the `Authorization: Bearer <token>` header. This deviates from standard REST conventions, may cause tokens to be logged by body loggers, and prevents use of standard middleware/proxy auth enforcement.

**Location:** All Netlify functions + client-side callers

### 2. Proposed Fix

**A. Created shared server-side utility:** `netlify/functions/utils/extractAuthToken.js`
- Extracts token from `Authorization: Bearer <token>` header (primary)
- Falls back to `authToken` in request body (backward compatibility during migration)

**B. Updated client-side code** to send `Authorization: Bearer <token>` header:
- `src/utils/adminAuth.js` — `fetchAllUsers()` and `fetchApiLogs()`
- `src/App.jsx` — impersonation session polling

**C. Updated server-side functions** to use `extractAuthToken()`:
- `adminGetImpersonationSession.js`
- `adminSuspendAccount.js`
- `adminEndImpersonation.js`
- `adminStartImpersonation.js`
- `adminReactivateAccount.js`
- `adminGetUsers.js` (inline extraction with fallback)

**D. Fixed CORS header** in `adminGetUsers.js` to include `Authorization`:
```javascript
'Access-Control-Allow-Headers': 'Content-Type, Authorization',
```

### 3. Automated Tests

```javascript
describe('AUTH-07: extractAuthToken utility', () => {
  it('should extract token from Authorization header', () => {
    const event = {
      headers: { authorization: 'Bearer test-token-123' },
      body: JSON.stringify({})
    };
    expect(extractAuthToken(event)).toBe('test-token-123');
  });

  it('should fall back to body authToken', () => {
    const event = {
      headers: {},
      body: JSON.stringify({ authToken: 'body-token-456' })
    };
    expect(extractAuthToken(event)).toBe('body-token-456');
  });

  it('should prefer header over body', () => {
    const event = {
      headers: { authorization: 'Bearer header-token' },
      body: JSON.stringify({ authToken: 'body-token' })
    };
    expect(extractAuthToken(event)).toBe('header-token');
  });

  it('should return null when no token available', () => {
    const event = { headers: {}, body: '{}' };
    expect(extractAuthToken(event)).toBeNull();
  });
});
```

### 4. Manual QA Steps

1. Log in as an admin.
2. Open Network tab in DevTools.
3. Navigate to Admin Dashboard (triggers `adminGetUsers` call).
4. **Expected:** Request headers include `Authorization: Bearer <token>`.
5. Verify admin dashboard loads user data correctly.
6. Check impersonation session polling in Network tab.
7. **Expected:** `adminGetImpersonationSession` calls use `Authorization` header.

### 5. Pass/Fail Criteria

- [ ] Client sends tokens in `Authorization: Bearer` header
- [ ] Server-side functions accept tokens from header
- [ ] Server-side functions still accept tokens from body (backward compatibility)
- [ ] All admin functions continue to work
- [ ] CORS preflight succeeds with `Authorization` header

### 6. Risks & Notes

- **Backward compatibility:** The `extractAuthToken` utility falls back to reading `authToken` from the request body, so any old client code still works during the transition.
- **Remaining functions:** Several admin functions (`adminExportAuditLogs`, `adminGetAuditLogs`, `adminGetContactDetail`, etc.) still parse `authToken` from the body. These should be migrated in a follow-up PR by importing `extractAuthToken`.
- **Rollout:** Deploy server-side changes first (they accept both patterns), then deploy client-side changes.

---

## Issue: AUTH-08 — No MFA Implementation (MEDIUM)

### 1. Problem Description

No multi-factor authentication existed anywhere in the application. Admin accounts controlling user suspension, impersonation, and data access were protected by password-only authentication.

### 2. Proposed Fix

Implemented TOTP-based MFA using Firebase Auth's built-in `multiFactor` API.

**New files:**
- `src/utils/mfa.js` — Core MFA utility (enrollment, verification, unenrollment)
- `src/components/MfaSetup.jsx` — Reusable MFA enrollment UI component

**Updated files:**
- `src/pages/Login.jsx` — Handles `auth/multi-factor-auth-required` error during sign-in, presents TOTP verification form

**MFA Flow:**
1. **Enrollment:** Admin navigates to security settings → clicks "Enable MFA" → scans QR code with authenticator app → enters 6-digit verification code → MFA enrolled
2. **Sign-in:** User enters email/password → Firebase returns `multi-factor-auth-required` → Login page shows TOTP input → User enters 6-digit code → sign-in completes
3. **Unenrollment:** Admin clicks "Disable MFA" in security settings → recent login may be required

**Supported authenticator apps:** Google Authenticator, Authy, 1Password, any TOTP-compatible app.

### 3. Automated Tests

```javascript
describe('AUTH-08: MFA utilities', () => {
  it('isMfaEnrolled returns false for user without MFA', () => {
    // Mock auth.currentUser with no enrolled factors
    expect(isMfaEnrolled()).toBe(false);
  });

  it('isMfaEnrolled returns true for user with MFA', () => {
    // Mock auth.currentUser with one enrolled TOTP factor
    expect(isMfaEnrolled()).toBe(true);
  });

  it('getEnrolledFactors returns empty array for no MFA', () => {
    expect(getEnrolledFactors()).toEqual([]);
  });
});

describe('AUTH-08: Login with MFA', () => {
  it('should show MFA form when auth/multi-factor-auth-required is thrown', async () => {
    // Mock signInWithEmailAndPassword to throw MFA error
    render(<Login />);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'admin@test.com' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'password' } });
    fireEvent.click(screen.getByText(/ACCESS MISSION CONTROL/i));

    await waitFor(() => {
      expect(screen.getByText('MFA Verification')).toBeInTheDocument();
      expect(screen.getByText(/6-digit code/i)).toBeInTheDocument();
    });
  });
});
```

### 4. Manual QA Steps

**Enrollment:**
1. Log in as admin.
2. Integrate `<MfaSetup />` component into admin settings page.
3. Click "Enable MFA".
4. **Expected:** QR code and secret key displayed.
5. Scan QR code with Google Authenticator.
6. Enter the 6-digit code from the app.
7. **Expected:** "MFA enabled successfully" message.

**Sign-in with MFA:**
1. Log out.
2. Enter email and password on login page.
3. **Expected:** After successful password verification, TOTP input form appears.
4. Enter the 6-digit code from authenticator app.
5. **Expected:** Sign-in completes, redirected to mission control.
6. Enter an incorrect code.
7. **Expected:** "Invalid verification code" error.

**Disable MFA:**
1. Navigate to security settings.
2. Click "Disable MFA".
3. **Expected:** MFA status changes to "Not Enabled".
4. Log out and back in.
5. **Expected:** No MFA prompt on sign-in.

### 5. Pass/Fail Criteria

- [ ] MFA enrollment generates valid TOTP QR code
- [ ] Authenticator app can scan and generate codes
- [ ] First verification code completes enrollment
- [ ] Sign-in with MFA shows verification form
- [ ] Valid TOTP code completes sign-in
- [ ] Invalid TOTP code shows error
- [ ] MFA can be disabled
- [ ] Non-MFA users can still sign in normally

### 6. Risks & Notes

- **Firebase project requirement:** TOTP MFA must be enabled in Firebase Console > Authentication > Sign-in method > Multi-factor authentication. Without this, enrollment will fail.
- **Rollout plan:**
  1. Deploy the code changes.
  2. Enable TOTP MFA in Firebase Console.
  3. Announce MFA availability to admin users.
  4. Consider enforcing MFA for admin accounts after adoption period.
- **Not enforced yet:** MFA is opt-in. To enforce for admins, add a check in `ProtectedAdminRoute` that verifies `multiFactor(user).enrolledFactors.length > 0`.
- **Integration point:** The `<MfaSetup />` component needs to be mounted in an admin settings page. This is provided as a reusable component but not yet wired into a specific page.

---

## Bonus Fix: AUTH-01 — Post-Login Redirect (LOW)

The Login page now navigates directly to `/mission-control-v2` instead of `/dashboard`, eliminating the unnecessary redirect hop. This was fixed as part of the Login page rewrite for AUTH-08.

## Bonus Fix: AUTH-02 — Raw Firebase Errors (LOW)

`Signup.jsx` now maps Firebase `error.code` values to user-friendly messages instead of rendering raw `error.message`. Error codes handled: `auth/email-already-in-use`, `auth/invalid-email`, `auth/weak-password`, `auth/too-many-requests`.

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `src/App.jsx` | AUTH-04 (protected admin-ping-test route), AUTH-03 (added /forgot-password route), AUTH-07 (Authorization header in impersonation polling) |
| `firestore.rules` | AUTH-06 (owner-only read rules, impersonation sessions deny-all) |
| `src/pages/ForgotPassword.jsx` | AUTH-03 (NEW — password reset page) |
| `src/pages/Login.jsx` | AUTH-01 (direct redirect), AUTH-03 (forgot-password link), AUTH-08 (MFA sign-in flow) |
| `src/pages/Signup.jsx` | AUTH-02 (friendly error messages) |
| `src/utils/mfa.js` | AUTH-08 (NEW — MFA enrollment/verification utilities) |
| `src/components/MfaSetup.jsx` | AUTH-08 (NEW — MFA setup UI component) |
| `src/utils/adminAuth.js` | AUTH-07 (Authorization header in fetch calls) |
| `netlify/functions/utils/extractAuthToken.js` | AUTH-07 (NEW — shared token extraction utility) |
| `netlify/functions/adminSuspendAccount.js` | AUTH-05 (Firestore role check), AUTH-07 (extractAuthToken) |
| `netlify/functions/adminGetImpersonationSession.js` | AUTH-07 (extractAuthToken) |
| `netlify/functions/adminEndImpersonation.js` | AUTH-07 (extractAuthToken) |
| `netlify/functions/adminStartImpersonation.js` | AUTH-07 (extractAuthToken) |
| `netlify/functions/adminReactivateAccount.js` | AUTH-07 (extractAuthToken) |
| `netlify/functions/adminGetUsers.js` | AUTH-07 (CORS header fix, inline token extraction) |

---

## Deployment Plan

### Phase 1: Server-Side (Zero Downtime)
1. Deploy Netlify functions (accept both header and body tokens).
2. Deploy Firestore rules (`firebase deploy --only firestore:rules`).
3. **Verify:** Admin dashboard still works. Regular user flows unaffected.

### Phase 2: Client-Side
1. Deploy frontend build with all React changes.
2. **Verify:** Login, signup, forgot-password, admin routes, MFA enrollment.

### Phase 3: MFA Activation
1. Enable TOTP MFA in Firebase Console.
2. Admin users enroll in MFA.
3. (Future) Enforce MFA for admin accounts.

### Rollback Plan
- **Firestore rules:** `firebase deploy --only firestore:rules` with previous rules file.
- **Netlify functions:** Redeploy previous function versions via Netlify dashboard.
- **Frontend:** Redeploy previous build via Netlify dashboard.
- All changes are backward-compatible due to the `extractAuthToken` fallback pattern.

---

## GitHub Issue Template

```markdown
## Auth Security Fixes — AUTH-01 through AUTH-08

### Checklist

#### HIGH Severity
- [ ] AUTH-04: `/admin-ping-test` wrapped with `<ProtectedAdminRoute>`
- [ ] AUTH-06: Firestore rules scoped to `request.auth.uid == userId`

#### MEDIUM Severity
- [ ] AUTH-03: `/forgot-password` page created and route registered
- [ ] AUTH-05: Admin suspend guard uses `checkAdminAccess()` (Firestore role)
- [ ] AUTH-07: Auth tokens sent via `Authorization: Bearer` header
- [ ] AUTH-08: MFA utilities and login flow implemented

#### LOW Severity
- [ ] AUTH-01: Login redirects directly to `/mission-control-v2`
- [ ] AUTH-02: Signup maps Firebase error codes to friendly messages

#### Verification
- [ ] Firestore rules unit tests pass
- [ ] Admin dashboard loads correctly
- [ ] Regular user flows (login, signup, checkout) unaffected
- [ ] Forgot password email sent successfully
- [ ] MFA enrollment works with authenticator app
- [ ] MFA sign-in flow works
- [ ] All admin functions accept Authorization header

#### Deploy
- [ ] Deploy Netlify functions (server-side first)
- [ ] Deploy Firestore rules
- [ ] Deploy frontend build
- [ ] Enable TOTP MFA in Firebase Console
- [ ] Communicate MFA availability to admin users
```
