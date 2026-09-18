/**
 * PipelineMoveRow — the theme tokens it reads must actually be in scope.
 *
 * 3600560 ("improve dark theme contrast for all 4 dark themes") swapped
 * hardcoded hex for `T.*` tokens throughout BarryChatPanel. Inside
 * BarryChatPanel that was correct — `T` is one of its props, defaulted to
 * DEFAULT_TOKENS. PipelineMoveRow is a SEPARATE top-level component in the
 * same file, and the same substitution was applied to it. Nothing put `T` in
 * its scope, so every render threw
 *
 *     ReferenceError: T is not defined
 *
 * and, since nothing wraps the Barry panel in an error boundary, took the
 * whole app down with it. It is reachable: Barry returns intent
 * ORGANIZE_PIPELINE ("who should move to hunter", "organize my pipeline")
 * and the panel maps every pipeline_moves entry onto this component.
 *
 * These tests render it for real. The first fails with the ReferenceError if
 * the `T` prop is ever dropped again; the second covers the default, so the
 * component survives a call site that forgets to pass one.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../firebase/config', () => ({ db: {}, auth: {} }));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  setDoc: async () => {},
  getDoc: async () => ({ exists: () => false }),
  collection: () => ({}),
  addDoc: async () => ({ id: 'x' }),
  updateDoc: async () => {},
  serverTimestamp: () => '__ts__',
}));
vi.mock('../context/ShellContext', () => ({ useShell: () => ({ barryOpen: true }) }));
vi.mock('../context/ImpersonationContext', () => ({
  getEffectiveUser: () => ({ uid: 'user_1', getIdToken: async () => 'tok' }),
}));

import { PipelineMoveRow } from '../components/dashboard/BarryChatPanel';

const move = {
  contact_id: 'contact_1',
  contact_name: 'Jane Doe',
  current_stage: 'scout',
  recommended_stage: 'hunter',
  reason: 'opened three emails',
};

describe('PipelineMoveRow theme tokens', () => {
  it('renders a move row when the panel passes its T down', () => {
    const T = { textMuted: '#a898c8', textFaint: '#7a6a9a' };

    render(<PipelineMoveRow move={move} onExecute={vi.fn()} T={T} />);

    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('Scout')).toBeTruthy();
    expect(screen.getByText('Hunter')).toBeTruthy();
    expect(screen.getByText('· opened three emails')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Move/ })).toBeTruthy();
  });

  it('applies the passed tokens rather than falling back', () => {
    const T = { textMuted: 'rgb(1, 2, 3)', textFaint: 'rgb(4, 5, 6)' };

    render(<PipelineMoveRow move={move} onExecute={vi.fn()} T={T} />);

    expect(screen.getByText('Scout').style.color).toBe('rgb(4, 5, 6)');
    expect(screen.getByText('· opened three emails').style.color).toBe('rgb(4, 5, 6)');
  });

  // A call site that forgets T must degrade to the panel's own defaults, not
  // throw. This is the guarantee that makes the bug unrepeatable rather than
  // merely fixed at the one site that has it today.
  it('renders with no T prop at all', () => {
    expect(() => render(<PipelineMoveRow move={move} onExecute={vi.fn()} />)).not.toThrow();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('Scout').style.color).toBeTruthy();
  });

  it('still drives the move action through onExecute', async () => {
    const onExecute = vi.fn(async () => {});
    render(<PipelineMoveRow move={move} onExecute={onExecute} T={{}} />);

    await userEvent.click(screen.getByRole('button', { name: /Move/ }));

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute.mock.calls[0][0]).toMatchObject({
      action_type: 'move_stage',
      contactId: 'contact_1',
      contactName: 'Jane Doe',
      params: { to_stage: 'hunter', reason: 'organize_pipeline' },
    });
    await waitFor(() => expect(screen.getByText('✓ Done')).toBeTruthy());
  });
});
