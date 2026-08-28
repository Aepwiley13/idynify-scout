import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },

  // ── ADR-006 compatibility boundary ────────────────────────────────────────
  //
  // The legacy reply fields are one-way mirrors written by
  // relationshipEventWriter. They exist so consumers that have not migrated
  // keep working; they are NOT authority, and the failure mode this rule
  // prevents is a new consumer quietly treating one as if it were.
  //
  // The allowlist below is the migration checklist. It only ever shrinks —
  // adding a path is a review conversation, removing one is progress, and when
  // it is empty the mirrors themselves can be deleted. Read from
  // `src/utils/relationshipRead.js` instead.
  {
    files: ['**/*.{js,jsx}'],
    ignores: [
      // Owns the mirrors, or owns the transition fallback.
      'netlify/functions/utils/relationshipEventWriter.js',
      'src/utils/relationshipRead.js',
      // Tests assert on the mirrors by name, which is the point of them.
      'src/test/**',
      // Not yet migrated — each of these is a tracked follow-up.
      'src/components/hunter/HunterContactDrawer.jsx',
      'src/components/hunter/BarryReplyCard.jsx',
      'src/pages/Scout/AllLeads.jsx',
      'src/components/firstTouch/FirstTouchModal.jsx',
      'src/hooks/usePendingReplies.js',
      'netlify/functions/barryOrientationBrief.js',
      'netlify/functions/gmail-poll-replies.js',
      'netlify/functions/utils/barryInboxAnalyzer.js',
      'netlify/functions/utils/barryStrategyRecommender.js',
      'netlify/functions/utils/barryContextAssembler.js',
      'netlify/functions/utils/relationshipContext.js',
      'netlify/functions/barryCSMRead.js',
      'netlify/functions/inferRelationshipWarmth.js',
      'src/utils/contactEngageStatus.js',
      'src/services/healthScore.js',
      'src/services/barryMemoryService.js',
      'src/components/contacts/KeyMetricsGrid.jsx',
      'src/components/csm/CSMCard.jsx',
      'src/components/csm/CSMDashboard.jsx',
      'src/components/onboarding/RelationshipFirstValue.jsx',
      'src/utils/relationshipSnapshot.js',
    ],
    rules: {
      'no-restricted-syntax': ['error', {
        selector:
          'MemberExpression[property.name=/^(conversationState|lastInboundAt|' +
          'lastInboundSubject|replyCount|last_reply_at|last_replied_at|replies_received)$/]',
        message:
          'ADR-006: this is a compatibility mirror, not relationship truth. ' +
          'Read from src/utils/relationshipRead.js instead.',
      }],
    },
  },
])