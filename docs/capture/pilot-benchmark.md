# The 50-card pilot

The pilot answers one question with real cards: does IDYNIFY read the person and company off a business card well enough to build Review → Match → Save Person on top of it? It also picks the model and prompt version that move forward. `scripts/captureBenchmark.mjs` runs it on your machine, through the same path as the endpoint: photo preparation, the extractor, the orchestrator and the assembler.

Everything stays local. Photos, labels and per-card results live in `capture-pilot/`, which is git-ignored. The script refuses to write card data anywhere git would track. Only each run's `summary.json` (counts, rates, timings, cost, versions) is safe to share or commit.

## 1. The 50 cards

Collect the front (the side with the person) of 50 real cards, as a user would photograph them: on a table, by phone, in ordinary light. Don't use scans. Aim for this mix, and record it in each label's `tags` so results can be split by kind:

| Count | Kind | Tag |
|---|---|---|
| 23 | Ordinary horizontal printed cards, mixed industries | `standard` |
| 5 | Taken imperfectly: angled, dim light, slight blur, finger in frame | `imperfect` |
| 4 | Vertical (portrait) cards | `vertical` |
| 4 | Dark background, light text | `dark` |
| 3 | Glossy, foil or embossed (glare) | `glossy` |
| 3 | Company name only in a logo | `logo-only` |
| 3 | Several phones (mobile + office + fax) or an extension | `multi-phone` |
| 3 | A personal address (gmail etc.) or no website | `personal-email` |
| 2 | International: a non-US number, accented or non-English names | `international` |

A card can carry several tags. HEIC and large photos are fine on a Mac (they're converted with `sips`). Name the files however you like; each label is matched by file name.

## 2. Labelling

```
mkdir -p capture-pilot/photos        # copy the 50 photos in here
node --env-file=.env scripts/captureBenchmark.mjs draft-labels
node scripts/captureBenchmark.mjs check-labels
```

`draft-labels` reads each photo once (default model) and writes `capture-pilot/labels/<photo name>.json`, prefilled with what was read. A draft is a typing shortcut, not the truth. Open each one next to its photo and correct it to what is actually printed:

```json
{
  "label": "capture-label/v1",
  "photo": "card-001.jpg",
  "status": "done",
  "tags": ["standard", "multi-phone"],
  "person": {
    "fullName": "Avery Quinn",
    "title": "Director of Partnerships",
    "emails": ["avery.quinn@example.com"],
    "phones": ["+1 (415) 555-0142", "+1 (415) 555-0100 x12"],
    "linkedinUrl": null
  },
  "company": {
    "name": "Example Robotics",
    "website": "www.example.com"
  }
}
```

Rules:
- **Exactly as printed.** Copy each value as it appears on the card. Spacing, case and punctuation don't matter (comparisons are normalized), but every letter and digit does.
- **Not printed means `null`, or `[]` for lists.** Never fill in something you know but the card doesn't show. Reading it from the card would then be a miss, and inventing it would be counted as inventing.
- **Name:** the person's full name as printed (with "Jr." or "PhD" if printed).
- **Title:** the person's job title as printed. A department alone is not a title.
- **Emails and phones:** every one printed. Phones go without their "M:" / "Tel" label; an extension may stay ("x12").
- **Company:** the organization's name as printed, including when it appears only in the logo (tag the card `logo-only`).
- **Website:** as printed. A website appearing only inside an email address is not a website: `null`.
- When a label is checked, set `"status": "done"`. Only `done` labels are scored. `check-labels` lists anything still in draft or malformed.

About an hour for 50 cards with drafts.

## 3. Running and comparing

```
node --env-file=.env scripts/captureBenchmark.mjs run
node --env-file=.env scripts/captureBenchmark.mjs run --config claude-opus-5-5:low,claude-sonnet-5-5:low,claude-haiku-5-5:medium
node scripts/captureBenchmark.mjs compare
```

- `run` reads every `done` card with each configuration (model and effort; default `claude-opus-5-5:low`). It prints accuracy, inventions, confirmed-field precision, role swaps, latency and cost against the gate, and writes `capture-pilot/runs/<time>-<config>/` containing:
  - `summary.json`: aggregates only;
  - `results.jsonl`: per card, local only.
- Exit code 0 means the gate passed and 3 means it didn't.
- **A prompt version is a commit.** To compare prompts, run on each branch, then `compare`. Every summary records its prompt version and commit.
- `--limit 5` is a cheap first try. `--concurrency` sets how many cards are read at once (default 2). `--extractor fake` runs the whole loop without any API.

Rough cost of one 50-card run: Opus 5.5 about $1–2, Sonnet 5.5 about $0.50–1, Haiku 5.5 under $0.10.

## 4. How a card is scored

What the app would show counts: a value that is not `unknown`.

| Measure | Meaning |
|---|---|
| Accuracy per field | Printed values read correctly ÷ printed values. A missed or failed read counts as wrong. |
| Invented | A value read where nothing like it is printed. For emails and phones, an extra value first pairs with a printed one it failed to match; that counts as a misreading, not an invention. |
| Confirmed fields correct | Of the scored fields the app would mark `confirmed`, how many are right. Confirmed means no review is asked for, so this must be near-perfect. |
| Role swaps | Cards where a value landed in another role's field: a title read as the company, the person read as the company, and so on. |
| Latency | Extraction time per card (preparation excluded): p50, p95, max. The endpoint adds network and Firestore time on top. |
| Cost | From the tokens used and the model that actually answered. |

## 5. The gate: when we move on to Review → Match → Save Person

On the 50 labelled cards:

| Gate | Target |
|---|---|
| Invented emails | 0 |
| Invented phones | 0 |
| Name accuracy | ≥ 95% |
| Email accuracy | ≥ 97% |
| Phone accuracy | ≥ 93% |
| Company accuracy | ≥ 90% |
| Title accuracy | ≥ 85% |
| Confirmed fields correct | ≥ 99% |
| Role swaps | ≤ 2% |
| p95 extraction latency | ≤ 8 s |
| Cost per scan | ≤ $0.05 |
| Photo preparation on a real iPhone and Android (Capture Lab) | ≤ 700 ms |

The cheapest configuration that passes moves forward. If none passes, `byTag` in the summary shows which kind of card fails, and that decides whether the next step is the prompt, the effort or the photo guidance. The full 200-card benchmark runs before beta.
