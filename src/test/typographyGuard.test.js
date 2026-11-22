/**
 * The typography guard, in CI.
 *
 * Phase 2A of UI Polish #002 introduced a type scale as CSS custom properties.
 * The thing that kills a design system is not the first week, it is the tenth
 * new file that quietly adds `font-size: 12px` because nothing objected.
 *
 * So: a ratchet. 1,023 existing violations across 74 files are recorded in
 * scripts/typography-baseline.json and are NOT failures — rewriting them was
 * explicitly out of scope. The suite fails only when a count goes up.
 *
 * If you are reading this because the suite just went red, you added type that
 * does not use the tokens. Use var(--text-*), var(--weight-*), var(--leading-*)
 * from src/index.css. If the addition is genuinely deliberate, re-record with
 *   node scripts/checkTypography.mjs --update
 * and say why in the commit message.
 */

import { describe, it, expect } from 'vitest';
import { compare, checkMirror, scanFile, RULES } from '../../scripts/checkTypography.mjs';

describe('typography guard', () => {
  it('adds no new violations beyond the recorded baseline', () => {
    const { regressions } = compare();
    const report = regressions
      .map((r) => {
        const rules = Object.entries(r.details)
          .map(([rule, hits]) => `      ${rule} (${RULES[rule]}): ${hits.slice(0, 5).join(', ')}`)
          .join('\n');
        return `  ${r.file}: ${r.was} -> ${r.now}\n${rules}`;
      })
      .join('\n');
    expect(report, `New typography violations:\n${report}`).toBe('');
  });

  it('keeps TYPE in tokens.js in step with the :root tokens', () => {
    expect(checkMirror()).toEqual([]);
  });

  it('still detects every rule it claims to — the ratchet is not a no-op', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typo-guard-'));
    const f = path.join(dir, 'probe.css');
    fs.writeFileSync(
      f,
      `.a { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
       .b { font-size: 12px; }
       .c { font-size: 9px; }
       .d { font-weight: 650; }
       .e { line-height: 1; }`,
    );
    const { out } = scanFile(f);
    fs.rmSync(dir, { recursive: true, force: true });

    // every rule the guard documents must have fired on the probe
    expect(Object.keys(out).sort()).toEqual(Object.keys(RULES).sort());
  });

  it('passes a file written the way new code should be', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typo-ok-'));
    const f = path.join(dir, 'good.css');
    fs.writeFileSync(
      f,
      `.title { font-size: var(--text-xl); font-weight: var(--weight-semibold); line-height: var(--leading-snug); }
       .body  { font-size: var(--text-base); line-height: var(--leading-normal); }
       .input { font-family: inherit; font-size: var(--text-md); }
       .code  { font-family: ui-monospace, Menlo, monospace; }
       .brand { font-family: 'Orbitron', sans-serif; font-weight: 800; }`,
    );
    const { out } = scanFile(f);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(out).toEqual({});
  });
});
