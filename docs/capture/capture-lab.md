# Capture Lab

`/admin/capture-lab` is a temporary, internal test surface for Relationship Capture. It is not the scanner UI.

```
Take Photo → Prepare Image → Quality Warning → Extract → Fields + Confidence
```

It exists to answer two questions on real phones before any review or save screen is designed:
- Does IDYNIFY read a real business card correctly?
- Is photo preparation fast enough on a real iPhone and Android?

## What it does and never does

- **Prepares the photo on the device** with PR 5's `prepareCardImage`: upright, resized, re-encoded, metadata stripped. It runs the blur, glare and darkness checks and shows any warning with "Use anyway" or "Retake". Fields read from a photo kept through "Use anyway" are capped at `likely`.
- **Sends it to `captureExtract`** (PR 6) as the signed-in admin, one new scan (`operationId`) per photo. It retries the same scan only when the endpoint says the failure is retryable.
- **Shows:**
  - the prepared image, its dimensions and size;
  - preparation time on this device, flagged above 700 ms;
  - the quality metrics and warnings;
  - the round-trip and server timings;
  - tokens;
  - the extractor, model, prompt version and adapter;
  - every field with its level (confirmed, likely, possible, unknown), score and check codes, including the fields not on the card.
- **"Copy diagnostics"** copies sizes, timings, codes, versions and counts plus the device's user agent, with no card value, for a test note.
- **It never saves, matches or changes a contact, company or relationship.** It imports nothing that can write (a test pins its imports), calls only `captureConfig` and `captureExtract`, and logs nothing. It shows no secret and no raw provider response; the endpoint never returns one.

## Who can use it, where

The route is admin-only (`ProtectedAdminRoute`). The endpoint also checks the capture mode for the account itself, so extraction works only where the deploy allows it:

| Deploy | Photo preparation | Extraction |
|---|---|---|
| Production with `CAPTURE_MODE=internal` | Yes | Yes, for admins and super admins |
| Production with `CAPTURE_MODE=off` (today) | Yes | Refused: "Capture is off for this account on this deploy" |
| Deploy previews and branch deploys | Yes | Refused (pinned off: previews share the production Firebase project) |

Which extractor answers is a server setting, `CAPTURE_EXTRACTOR`:
- `fake` gives the fictional Avery Quinn card every time. It is good for checking the flow on a phone first.
- `claude-vision` gives the real reading. It uses the existing `ANTHROPIC_API_KEY`.

The page shows which one answered.

## Running a real card

1. In Netlify, Production context: set `CAPTURE_MODE=internal` and `CAPTURE_EXTRACTOR=claude-vision` (or `fake` first), then redeploy.
2. On your phone, signed in as an admin, open `https://idynify.com/admin/capture-lab`.
3. Tap **Take photo** and photograph the card (front side, on a table, normal light).
4. Check the prepared image, its preparation time and any warning; choose **Use anyway** or **Retake**.
5. Tap **Extract**. Check each field against the card, and its confidence.
6. **Copy diagnostics** for the test note.

To measure the 700 ms preparation target, take about 10 photos on each phone (one iPhone, one Android) and note the preparation time each shows.

To switch capture off again, set `CAPTURE_MODE=off`. No deploy of code is needed.
