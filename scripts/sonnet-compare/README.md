# Sonnet 4.5 vs Sonnet 5.5 on the Barry endpoints

Validation tooling for #699. `claude-sonnet-4-5-20250929` retires on
2026-11-30, and nine Barry endpoints (11 calls) run on it. This compares it
with its replacement before production moves. **It changes nothing in
production and reads nothing from it.** Production keeps calling
`MODEL_BARRY_SONNET` (Sonnet 4.5 by default) until the default in
`netlify/functions/utils/models.js` is changed on purpose.

## Run it

From the repo root, where your Anthropic key is already in your environment:

```sh
node scripts/sonnet-compare/compare.mjs            # dry run: capture, plan, cost ceiling — sends nothing
node scripts/sonnet-compare/compare.mjs --run      # send the requests and write the report
```

`--run` needs `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) in the shell.
The SDK reads it; the script never prints or saves it.

The default run is 33 requests × 3 variants = 99 calls. The dry run prints an
upper bound on cost (every reply at `max_tokens`), currently about $2.

Useful options (`--help` lists them all):

| Option | Effect |
|---|---|
| `--sites=engagement-message,followup` | only those call sites |
| `--variants=sonnet-4.5,sonnet-5.5-default` | other variants (below) |
| `--concurrency=1` | slower, gentler on rate limits; latency is cleaner |
| `--print=all` / `--print=none` | print every reply / none (default: the message writers) |
| `--out=DIR` | where the report goes (default `.sonnet-compare/<timestamp>/`, git-ignored) |

## What it compares

Each variant is the endpoint's own request with only these fields changed:

| Variant | Request |
|---|---|
| `sonnet-4.5` (default) | `model: claude-sonnet-4-5-20250929` — production today |
| `sonnet-5.5-between-tools` (default) | `model: claude-sonnet-5-5`, `thinking: { type: 'between_tools' }` — thinking off |
| `sonnet-5.5-low` (default) | `model: claude-sonnet-5-5`, `output_config: { effort: 'low' }` — adaptive thinking, low effort |
| `sonnet-5.5-default` | `model: claude-sonnet-5-5` only — the plain swap #699 warns against |
| `sonnet-4.6` | `model: claude-sonnet-4-6` — the fallback named in `models.js` |

Prompts and `max_tokens` are never edited. The point is to see how each model
does with the requests production sends today.

## How the requests are built

The prompts are not copied into this tool. `capture.mjs` imports the **real
handlers** and runs them on the synthetic inputs in `fixtures.mjs`, with these
swapped out by Node loader hooks (`loader.mjs`), only for imports made from
`netlify/functions/`:

- the Anthropic SDK becomes a recorder: `messages.create` saves the request and sends nothing;
- Firestore becomes an in-memory store holding only the fixtures;
- `logApiUsage` becomes a no-op;
- `fetch` answers only the Firebase token lookup and refuses everything else.

So each request is exactly what that endpoint would send for that input,
RECON context included, and capture can't reach the network or Firestore.
Then `compare.mjs` sends each captured request to each variant with the real SDK.

## What it records

For every request × variant:

- **reply read** through the shared `readClaudeText` (`netlify/functions/utils/claudeResponse.js`): thinking blocks ignored; refusal, truncation (`max_tokens`) and empty replies recorded by kind;
- **endpoint check** (`checks.mjs`): does the text pass the same parsing its handler does — e.g. five required keys for context, `SUBJECT:`/`BODY:` for campaign messages, three messages for engagement. A failure here means the endpoint would have errored or fallen back;
- **latency** (wall clock, no SDK retries, so an overload shows up as an API error rather than a slow call);
- **tokens** in/out and an estimated cost at list prices;
- **stop reason** and the model that actually answered.

The terminal shows a summary table per call site and variant, then the full
replies of the four message writers (sequence step, campaign message,
follow-up, engagement message) side by side for a tone read.
`report.md` has the same table and every reply case by case; `results.json`
has everything, including the captured requests.

## Reading the result

#699's bar for a call site to pass:

- every reply passes its endpoint check;
- no `max_tokens` stops, and no refusals on these benign inputs;
- p95 latency well inside the function's Netlify timeout (thinking adds latency);
- for the four message writers, a person reads the replies side by side and is happy with the tone.

Pick the thinking setting per endpoint from the two 5.5 variants. If Sonnet 5.5
can't pass by 2026-11-16, run `--variants=sonnet-4.5,sonnet-4.6` and move to
the fallback instead.

## Data

All inputs are fictional: invented people and companies, `example.com`/`.org`
addresses. Replies are printed to your terminal and written under
`.sonnet-compare/`, which git ignores. Nothing is read from production or
written to it, and no usage rows are logged.

## Adding cases

There are three cases per call site; #699 suggests about ten. Add to `CASES` in
`fixtures.mjs`, keeping them fictional and on-topic: the ICP conversation answers
off-topic input itself without calling Claude, and capture stops with a list of
any case that sent nothing.

## Self-test

`node scripts/sonnet-compare/compare.mjs --run --fake-api` runs the whole
tool against a fake client (thinking-first replies, refusals, truncation,
malformed text) and sends nothing. Use it after changing the tool.
