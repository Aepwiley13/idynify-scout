# Recon Authentication & Authorization Evaluation Report

**Date:** 2026-01-30
**Scope:** Login/Logout, Permission Levels, Session Management, Access Control
**Codebase:** idynify-scout (React + Firebase Auth + Netlify Functions)

---

## Executive Summary

The application uses Firebase Authentication (email/password) with Firestore-backed role management and Netlify serverless functions for admin operations. The auth system is functional but has **8 findings** ranging from critical to informational severity. No MFA is implemented. The two-tier protection model (client-side route guards + server-side token verification) is architecturally sound, but several gaps in consistency and enforcement exist.

---

## 1. Login Flow

### Expected Behavior
Users enter email/password, authenticate via Firebase, and are redirected to the appropriate post-login page.

### Actual Results

| Test Case | Result | Notes |
|-----------|--------|-------|
| Valid credentials | PASS | Firebase `signInWithEmailAndPassword` works correctly |
| Invalid credentials | PASS | Generic error message shown ("Invalid credentials") — good practice |
| Empty fields | PASS | HTML `required` attribute prevents submission |
| Already logged in | PASS | `/login` route redirects to `/mission-control-v2` via `App.jsx:232` |

### FINDING AUTH-01: Post-Login Redirect Mismatch

- **Severity:** LOW
- **Location:** `src/pages/Login.jsx:18`
- **Description:** After successful login, `navigate('/dashboard')` is called, but `/dashboard` is a redirect route (`App.jsx:498`) that simply forwards to `/mission-control-v2`. This creates an unnecessary redirect hop.
- **Expected:** Direct navigation to `/mission-control-v2`
- **Actual:** `Login.jsx` navigates to `/dashboard` → `App.jsx` redirects to `/mission-control-v2`
- **Impact:** Extra redirect causes a brief flash; no functional breakage.
- **Fix:** Change `Login.jsx:18` from `navigate('/dashboard')` to `navigate('/mission-control-v2')`.

---

## 2. Logout Flow

### Expected Behavior
User clicks logout, Firebase session is destroyed, user is redirected to `/login`.

### Actual Results

| Test Case | Result | Notes |
|-----------|--------|-------|
| Logout from MainLayout | PASS | `auth.signOut()` called, navigates to `/login` (`MainLayout.jsx:13-19`) |
| Auth state clears | PASS | `onAuthStateChanged` in `App.jsx:101-104` sets user/userData to null |
| Protected routes after logout | PASS | `ProtectedRoute` redirects to `/login` when `user` is null |

No issues found with the logout flow.

---

## 3. Signup Flow

### Expected Behavior
New users create an account, a Firestore user document is created with `hasCompletedPayment: false`, and user is redirected to checkout.

### Actual Results

| Test Case | Result | Notes |
|-----------|--------|-------|
| Valid signup | PASS | Account created, Firestore doc written, redirect to `/checkout` |
| Password mismatch | PASS | Client-side validation catches it |
| Weak password (<6 chars) | PASS | Both client-side and Firebase enforce minimum 6 characters |
| Duplicate email | PASS | Firebase returns error, displayed to user |
| Tier from URL param | PASS | `?tier=pro` or `?tier=starter` correctly parsed |

### FINDING AUTH-02: Raw Firebase Error Exposed to User

- **Severity:** LOW
- **Location:** `src/pages/Signup.jsx:91`
- **Description:** On signup failure, `error.message` is displayed directly to the user. Firebase error messages include internal prefixes like `"Firebase: Error (auth/email-already-in-use)."` which leak implementation details.
- **Expected:** User-friendly error messages.
- **Actual:** Raw Firebase SDK error strings are rendered.
- **Fix:** Map Firebase error codes to friendly messages (e.g., `auth/email-already-in-use` → "An account with this email already exists").

### FINDING AUTH-03: Broken Forgot Password Link

- **Severity:** MEDIUM
- **Location:** `src/pages/Signup.jsx:304`
- **Description:** The signup page has a "Forgot your password? Reset it here" link that navigates to `/forgot-password`. However, no `/forgot-password` route exists in `App.jsx`. The catch-all route (`App.jsx:588`) redirects to `/`, which redirects back to `/login` for unauthenticated users — a silent failure with no password reset capability exposed.
- **Expected:** A password reset page or flow.
- **Actual:** Navigates to nonexistent route, silently redirects to homepage/login.
- **Fix:** Either implement a `/forgot-password` page using Firebase's `sendPasswordResetEmail()`, or remove the dead link.

---

## 4. Permission Levels & Access Control

### Role Architecture

The application has three effective permission tiers:

| Tier | Mechanism | Enforced By |
|------|-----------|-------------|
| **Unauthenticated** | No Firebase session | Client route guards + Firestore rules |
| **User (paid)** | `hasCompletedPayment: true` | `ProtectedRoute` component |
| **User (unpaid)** | `hasCompletedPayment: false` | `ProtectedRoute` redirects to `/checkout` |
| **Admin** | `role: 'admin'` in Firestore OR `ADMIN_USER_IDS` env var | `ProtectedAdminRoute` (client) + `checkAdminAccess` (server) |

### Test Results

| Test Case | Result | Notes |
|-----------|--------|-------|
| Unauthenticated → protected route | PASS | Redirected to `/login` |
| Unpaid user → protected route | PASS | Redirected to `/checkout` |
| Paid user → protected route | PASS | Access granted |
| Non-admin → `/admin` | PASS | "Access Denied" page shown |
| Admin → `/admin` | PASS | Dashboard renders |
| Admin → suspend another admin | PASS | Server-side check blocks (custom claims check) |
| Admin → impersonate another admin | PASS | Server-side check blocks (Firestore role check) |

### FINDING AUTH-04: Admin Ping Test Route Is Completely Unprotected

- **Severity:** HIGH
- **Location:** `src/App.jsx:446`
- **Description:** The route `/admin-ping-test` renders `<AdminPingTest />` without **any** route guard — no `ProtectedRoute`, no `ProtectedAdminRoute`. Any unauthenticated visitor can access this page.
- **Evidence:** `App.jsx:446`: `<Route path="/admin-ping-test" element={<AdminPingTest />} />`
- **Impact:** The page itself reveals the admin API base URL (`VITE_ADMIN_API_BASE`) and confirms whether the admin backend is reachable. This is information disclosure that aids reconnaissance by an attacker.
- **Fix:** Wrap with `<ProtectedAdminRoute>` or remove entirely if it's a development-only tool.

### FINDING AUTH-05: Inconsistent Admin-Protection Check in Suspend Flow

- **Severity:** MEDIUM
- **Location:** `netlify/functions/adminSuspendAccount.js:132-133`
- **Description:** The suspend function checks `targetUser.customClaims.admin === true` to prevent suspending another admin. However, the application does **not** use Firebase custom claims for role management — it uses the Firestore `users/{uid}/role` field. The `customClaims` check will **never match** because no code sets custom claims. This means an admin **can** suspend another admin account, contrary to the intended safeguard.
- **Expected:** Cannot suspend another admin.
- **Actual:** The custom claims check is a no-op; the Firestore role is not checked.
- **Fix:** Replace `targetUserClaims.admin === true` with a Firestore role check: query `users/{targetUserId}` and check `role === 'admin'`, consistent with how admin status is determined everywhere else.

### FINDING AUTH-06: Firestore Rules Allow Any Authenticated User to Read All User Documents

- **Severity:** HIGH
- **Location:** `firestore.rules:7`
- **Description:** The Firestore security rule `allow read: if request.auth != null;` on `/users/{userId}` means **any authenticated user** can read **any other user's** document, including their email, role, subscription tier, credits, payment status, and all subcollection data (companies, contacts, leads, etc. via rule on line 13).
- **Evidence:**
  ```
  match /users/{userId} {
    allow read: if request.auth != null;  // ANY auth user can read ANY user doc
    allow write: if request.auth != null && request.auth.uid == userId;
  }
  match /users/{userId}/{document=**} {
    allow read: if request.auth != null;  // ANY auth user can read ANY subcollection
  }
  ```
- **Impact:** A malicious authenticated user (even one who hasn't paid) could enumerate all user documents and subcollections using the Firestore client SDK directly, bypassing all UI-level protections. This is a data exposure vulnerability.
- **Fix:** Change read rules to `request.auth.uid == userId` for user documents. If admin read access is needed from the client, add an explicit admin check or handle admin reads exclusively through the server-side Admin SDK (which bypasses rules).

---

## 5. Session Management & Token Handling

### Architecture
- Firebase Auth handles session/token lifecycle automatically
- ID tokens are short-lived (~1 hour), auto-refreshed by the Firebase SDK
- No custom session store or cookie-based sessions
- Impersonation sessions are stored in Firestore with 30-minute TTL

### Test Results

| Test Case | Result | Notes |
|-----------|--------|-------|
| Token auto-refresh | PASS (by design) | Firebase SDK handles transparently |
| Session persistence | PASS | Firebase default persistence (IndexedDB) survives page refresh |
| Impersonation timeout | PASS | 30-minute expiry with auto-cleanup |
| Impersonation polling | PASS | `App.jsx:149` polls every 30 seconds |
| Suspended user session revocation | PASS | `revokeRefreshTokens` + `disabled: true` in `adminSuspendAccount.js:186-191` |

### FINDING AUTH-07: Auth Token Passed in Request Body Instead of Authorization Header

- **Severity:** MEDIUM
- **Location:** All Netlify function calls (e.g., `App.jsx:127`, `adminAuth.js:56`)
- **Description:** The auth token is sent as `authToken` in the JSON POST body rather than in the `Authorization: Bearer <token>` header. While functionally equivalent for security, this is a deviation from standard practice that:
  1. Prevents use of standard middleware/proxy-level auth enforcement
  2. Means tokens may be logged by request body loggers
  3. Is inconsistent with the CORS header that declares `Authorization` as allowed (`Access-Control-Allow-Headers: Content-Type, Authorization`)
- **Impact:** No direct vulnerability, but increases risk surface and complicates future integration with standard auth middleware.
- **Fix:** Migrate to `Authorization: Bearer <token>` header pattern across all function calls.

---

## 6. MFA / Multi-Factor Authentication

### FINDING AUTH-08: No MFA Implementation

- **Severity:** MEDIUM (for an application handling business contact data and payment info)
- **Description:** There is no multi-factor authentication. Firebase Auth supports MFA (TOTP, SMS, phone), but none is configured. Admin accounts that control user suspension, impersonation, and data access are protected by password-only authentication.
- **Impact:** Admin account compromise via credential stuffing or phishing would grant full platform access including user impersonation.
- **Recommendation:** Implement MFA at minimum for admin accounts. Firebase supports `multiFactor` enrollment. Consider enforcing MFA for all users handling sensitive business data.

---

## 7. Additional Observations (Informational)

### 7a. Duplicated Firebase Admin Initialization
`adminGetUsers.js` initializes its own Firebase Admin instance (lines 8-25) instead of importing from the shared `firebase-admin.js` module. This creates maintenance burden and risks configuration drift. Other admin functions (e.g., `adminSuspendAccount.js`) correctly use the shared module.

### 7b. No Rate Limiting on Login
There is no rate limiting on the login endpoint. Firebase provides some built-in brute force protection, but there are no application-level controls.

### 7c. No CSRF Protection
API calls use POST with JSON bodies which provides some implicit CSRF protection (browsers won't send JSON content-type cross-origin without CORS), but there are no explicit CSRF tokens.

### 7d. Impersonation Fail-Open Behavior
In `impersonation.js:125`, the `getActiveImpersonationSession` function returns `null` on error (fail-open). If Firestore is temporarily unavailable, this would silently deactivate the impersonation banner rather than alerting the admin. This is acceptable for UX but worth noting.

---

## Findings Summary

| ID | Severity | Title | Location |
|----|----------|-------|----------|
| AUTH-01 | LOW | Post-login redirect goes through unnecessary hop | `Login.jsx:18` |
| AUTH-02 | LOW | Raw Firebase error messages exposed to users | `Signup.jsx:91` |
| AUTH-03 | MEDIUM | Forgot password link navigates to nonexistent route | `Signup.jsx:304` |
| AUTH-04 | HIGH | Admin ping test page is completely unprotected | `App.jsx:446` |
| AUTH-05 | MEDIUM | Admin-suspend-admin guard checks custom claims (never set) instead of Firestore role | `adminSuspendAccount.js:132` |
| AUTH-06 | HIGH | Any authenticated user can read all user documents and subcollections | `firestore.rules:7,13` |
| AUTH-07 | MEDIUM | Auth tokens sent in request body instead of Authorization header | Multiple files |
| AUTH-08 | MEDIUM | No MFA implementation for any user tier | Application-wide |

---

## Answers to Evaluation Questions

### Is access control consistent?
**Partially.** The client-side route guards (`ProtectedRoute` and `ProtectedAdminRoute`) are applied consistently to all protected routes except `/admin-ping-test` (AUTH-04). Server-side admin functions consistently verify tokens and check admin access. However, the admin-protection guard in the suspend flow uses the wrong mechanism (AUTH-05), and Firestore rules are overly permissive (AUTH-06).

### Do unauthorized users get blocked appropriately?
**Mostly yes, with exceptions.** Unauthenticated users are correctly redirected to `/login`. Unpaid users are correctly redirected to `/checkout`. Non-admin users see an "Access Denied" page when trying to access admin routes. Server-side functions return 401/403 appropriately. The exception is `/admin-ping-test` which has no protection at all.

### Any errors or unexpected redirects?
**Yes.** The login page redirects to `/dashboard` which then redirects to `/mission-control-v2` — an unnecessary double redirect (AUTH-01). The forgot-password link on the signup page leads to a nonexistent route that silently redirects to the homepage (AUTH-03). The 404 catch-all route redirects to `/` which is reasonable behavior.
