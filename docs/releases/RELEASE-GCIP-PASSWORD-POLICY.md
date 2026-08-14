# Release Procedure — GCIP Password Policy Change

**Change ID:** REL-AUTH-001
**Owner:** Aaron (Architecture Lead) — console change
**Prepared by:** Team A, Signup Rebuild sprint
**Authorized by:** Phase 2 Authorization, D4 — "Option A — configure real GCIP policy"
**Status:** ⬜ Not executed

> **This is a production authentication configuration change.** It is not part of
> the code deploy, it is not reversible by a git revert, and it affects users who
> have no connection to this sprint. It gets its own procedure, its own explicit
> confirmation, and its own rollback.

---

## 1 — What changes

The Google Cloud Identity Platform password policy on the Firebase project moves
from the **default** to an **explicit policy**.

| | Before (today) | After |
|---|---|---|
| Minimum length | 6 | **8** |
| Uppercase required | no | **yes** |
| Lowercase required | no | **yes** |
| Numeric required | no | **yes** |
| Special character required | no | no |
| Enforcement mode | n/a | **Enforce on sign-up and password change only** |

Today the API accepts `aaaaaa`. After this change it will not.

---

## 2 — Why it is a release step and not a code change

The signup rebuild displays a live password-requirement checklist. Per the
implementation brief, *"Do not display requirements that are not actually
enforced."*

The checklist is driven by `validatePassword(auth, password)` from
`firebase/auth`, which reads **the project's actual policy** — so the UI is a
mirror of this console setting, not a copy of it. That has a useful property and
one hazard:

- **Property:** the checklist cannot drift from reality. Whatever is configured
  here is what the user sees.
- **Hazard:** if this step is skipped, the shipped UI will silently display the
  *old* rule ("6+ characters") and the sprint's acceptance criterion — "password
  requirements reflect actual Firebase auth rules" — will pass while the intended
  policy is not in force.

**Ship the code and execute this step in the same release window.**

---

## 3 — Blast radius, stated precisely

**Who is affected immediately:** nobody. No existing session is invalidated. No
existing user is signed out. No existing password stops working for sign-in.

**Who is affected later:** any user who **creates an account** or **changes /
resets a password** after this change. Their new password must satisfy the
policy.

**Explicitly NOT enabled — read this before touching the console.**

GCIP offers a second enforcement mode, variously labelled *"Require on next
sign-in"* / *"force upgrade"*. **Do not enable it.** It forces every existing
user to change their password at their next sign-in.

Phase 2 Authorization accepted this consequence and no more:

> "Existing users who next reset their passwords will be subject to the new
> policy."

That is the **sign-up and password-change** mode. The force-upgrade mode would
instead interrupt every currently paying user at their next login — a materially
larger blast radius than was authorized. If the console presents it as a
checkbox or a second radio option, leave it off.

---

## 4 — Pre-flight

- [ ] Signup rebuild code is built, reviewed, and staged for deploy in this same window
- [ ] `validatePassword()` integration verified against the **current** (default) policy in a non-production environment — confirms the UI mirrors whatever is configured
- [ ] Aaron has given **explicit confirmation to proceed** on the day (per D4: *"flag it at release time, and get explicit confirmation before the console change is made"*)
- [ ] A rollback owner is available for the duration of the release window

---

## 5 — Execution

Performed by Aaron. Team A does not have and should not have console access.

1. Firebase Console → the `idynify-scout-dev` project (**and each additional
   environment that serves real users — confirm the full list before starting;
   `src/firebase/config.js` hardcodes one project, which may not be the whole
   picture**)
2. **Authentication → Settings → Password policy**
3. Set enforcement to **Enforce** (sign-up and password change)
4. Minimum length: **8**
5. Enable: **uppercase**, **lowercase**, **numeric**
6. Leave **special character** disabled
7. Leave any *"require on next sign-in" / force-upgrade* option **OFF** (§3)
8. Save
9. Record the timestamp and the operator in §8 below

---

## 6 — Verification

Run against the deployed signup page, in this order.

| # | Check | Expected |
|---|---|---|
| 1 | Load `/signup`, focus the password field | Checklist renders **8+ characters · Upper & lowercase · At least one number** — sourced from the live policy, not hardcoded |
| 2 | Type `abc` | All three rules show unmet |
| 3 | Type `abcdefgh` | Length met; uppercase and numeric unmet |
| 4 | Type `Abcdefg1` | All three met; CTA enabled |
| 5 | Submit a **new** account with `Abcdefg1` | Account is created |
| 6 | Attempt a new account with `aaaaaa` | Rejected. Client blocks it, **and** the API would reject it — verify the server rule independently, not only the UI |
| 7 | Sign in as a **pre-existing** user with their **old, non-compliant** password | ✅ **Still works.** If this fails, force-upgrade mode is on — go to §7 immediately |
| 8 | Trigger a password reset for a test user, set a non-compliant password | Rejected by Firebase |

Check 7 is the one that matters most. It is the difference between the change
that was authorized and the one that was not.

---

## 7 — Rollback

The policy is a console setting; reverting is immediate and has no data
migration.

1. Firebase Console → Authentication → Settings → Password policy
2. Set enforcement back to **off** (or restore minimum 6 with no character
   requirements)
3. Save

**Effect:** the signup checklist follows automatically — because it reads the
live policy, it will revert to displaying the old rule with **no code deploy
required**. Accounts created under the stricter policy are unaffected; their
passwords remain valid.

**Rollback trigger:** verification check 7 fails, or new-account creation is
blocked for compliant passwords.

---

## 8 — Execution record

| Field | Value |
|---|---|
| Executed by | |
| Date / time (UTC) | |
| Environment(s) changed | |
| Force-upgrade left OFF? | ⬜ confirmed |
| Verification 1–8 passed | ⬜ |
| Rolled back? | ⬜ no ⬜ yes — reason: |

---

## 9 — Follow-ups

- **LEGAL-001** — Terms and Privacy links, deferred per D2. Unrelated to this
  change; noted so the two do not get conflated at release time.
- If additional Firebase projects serve production users, this procedure must be
  repeated per project. `src/firebase/config.js` hardcodes a single config, so
  the environment list must be confirmed by someone with console visibility —
  not inferred from the repository.
