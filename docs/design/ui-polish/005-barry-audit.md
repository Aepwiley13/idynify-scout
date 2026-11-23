# #005 — Barry's Visual Experience (read-only audit)

**Status: audit, awaiting approval. Nothing implemented.** Audited on `main` at `dcc19e54`.
Measured from the source; visual findings need a logged-in pass in light and dark themes.

## Where Barry is

Barry appears in **223 files** and about **35 Barry-named components** across 14 areas.

| Surface | Component(s) | Reached from |
|---|---|---|
| Shell panel (one conversation, kept across navigation) | `BarryChatPanel` in `MainLayout` | Sidebar Barry card (wide) or icon (compact), pinned in the footer |
| Full-page workspace | `pages/Barry/BarryWorkspace` at `/barry` | Only the first-run experience (which redirects there) or typing the URL. No navigation entry links to it |
| Inline cards in Hunter | `BarryInsightsCard`, `BarryReasoningDisplay`, `BarryRecommendationCard`, `BarryReplyCard`, `BarryWarningCard` | Hunter engagement surfaces |
| Recon coaching | `BarryReconCoach`, `BarryReconGuide`, `BarryCoachingResponse`, `BarryKnowledgeButton`; Recon → What Barry Knows | Recon |
| Contacts | `BarryContext`, `BarryInsightPanel` | Contact profile and drawer |
| Scout | `BarryICPPanel` and others | ICP / Daily Discoveries |
| Mission Control | `BarryMorningBrief` | Dashboard |
| Onboarding | `BarryOnboarding`, `BarryTyping` | Signup flow |

## Findings

### Consistency

1. **Barry has five visual identities.** 🐻 emoji in 27 files (Scout, Hunter, Recon…); the avatar image
   (`ASSETS.barryAvatar` / `barry-avatar`, plus `public/barry-bear.jpg`) in 22; 🤖 in 8 (all Recon);
   🧠 in 6 (Mission Control dashboard); and the lucide `Brain` / `Sparkles` / `MessageSquare` icons
   in Barry-named components. A user meets a different Barry in each module.
2. **His outputs are named inconsistently:** "Barry's Recommendation", "Barry's Intel", "Barry's Read",
   "Barry's Playbook", "Barry ICP Conversation", "Barry Mission Co-pilot", "Talk to Barry", "Chat with
   Barry", "Ask Barry". There's no shared vocabulary for "Barry suggests" vs "Barry explains" vs
   "ask Barry".
3. **His colour is split between a token and literals.** `--barry-color` is used in two places; Barry-named
   files otherwise hardcode violets (`#7c3aed` ×9, `#6d28d9`, `#a78bfa`, `#ede9fe`, `#ddd6fe`) and
   pink `#e8197d`, alongside Tailwind `purple-300/400/500`.

### Accessibility

4. **Streaming answers aren't announced on the full page.** `BarryWorkspace` (1,107 lines) has no
   `aria-live` and no `role="log"`. `BarryChatPanel` has one live region. `BarryTyping` (the "Barry is
   typing" indicator) has no status role, so screen-reader users get no feedback while he answers.
5. **The shell panel is solid:** `role="dialog"`, `aria-modal`, a focus trap, Escape to close, `inert`
   when hidden, and the open control has an aria-label. Keep this as the reference.
6. **Low-contrast Barry badges:** `BarryRecommendationCard` uses `text-purple-300` on a `purple-500/20`
   tint, about 1.8:1 in light themes. `BarryReasoningDisplay` uses a `text-purple-400` icon. This is the
   same defect class #002.1 / #002.2 fixed.
7. **Inline panels have no landmarks or labels.** `BarryInsightPanel`, `BarryMorningBrief` and
   `BarryContext` have no region role or heading association, so they can't be found by landmark
   navigation.

### Discoverability

8. **The full workspace is hidden.** `/barry` has no sidebar, panel or command entry. Outside first
   run, the only Barry users find is the side panel, which has no "open full workspace" path.
9. **Barry's sidebar card stays the same everywhere.** Each route has a Barry context
   (`barryModule` in `navigationModel`), but the card doesn't show it (for example "Ask Barry about
   this campaign"). Users can't tell that he knows where they are.

### Usefulness and gating

10. **Gating is uneven between surfaces (to verify).** For accounts without paid access, the panel and
    the sidebar card are removed (`barryAvailableFor`, Billing Phase 1d), and the server returns 402.
    None of the 14 inline Barry components reads that gate, so a Free account may see inline Barry
    actions that fail. Confirm against their parents before acting. **Billing-adjacent: coordinate
    with billing; no change proposed here.**

## Recommendations (ranked)

| # | Recommendation | Impact | Effort | Risk |
|---|---|---|---|---|
| 005.1 | **One Barry identity:** the avatar image as the only depiction, with a shared `BarryMark` (sizes 16 / 24 / 32 / 48, decorative or labelled). Retire 🐻 🤖 🧠 and the Brain / Sparkles stand-ins | High (consistency) | Medium (about 60 files, mechanical) | Low |
| 005.2 | **Announce Barry:** `role="log"` + `aria-live="polite"` on the workspace and panel threads; `role="status"` on `BarryTyping` | High (a11y) | Low | Low |
| 005.3 | **Barry colour tokens:** `--barry`, `--barry-bg`, `--barry-border` per theme, replacing literals and Tailwind purples in Barry components; fix the 1.8:1 badges | Medium | Low–medium | Low |
| 005.4 | **Name his output types:** a short vocabulary (Ask Barry · Barry suggests · Barry explains · Barry's brief) applied to headings and buttons | Medium | Low | Low |
| 005.5 | **Make the workspace findable:** an "Open full workspace" control in the panel header; Barry in the command bar | Medium | Low | Low |
| 005.6 | **Context on the sidebar card:** for example "Ask about Hunter" from `resolveBarryModule` (desktop) | Medium | Low | Low |
| 005.7 | **Landmarks for inline Barry panels:** `role="region"` + `aria-labelledby` on Insight, Context and Morning Brief | Low–medium | Low | Low |
| — | Gating consistency for inline Barry (finding 10) | High if confirmed | — | Billing-owned: needs coordination |

Sequencing: 005.2 and 005.3 can ship on their own. 005.1 should follow 003.6, because the sidebar
card's markup moves into the unified sidebar.
