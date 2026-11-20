/**
 * The two things My Card says about an uploaded photo that is not safe or not back: that the tab will
 * not keep it, and that it could not be restored. Words only; the rules are in the state and the storage.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyCardNotices } from '../pages/ContactHub/myCard/MyCardNotices';
import { initialMyCardState } from '../pages/ContactHub/myCard/state/myCardState';
import { fingerprintOf, photoDataUrl } from './helpers/photoFixtures';

const NO_CHOICES = { canLoadLatest: false, canSaveOver: false };
const handlers = () => ({
  onRetrySave: vi.fn(), onDismissRecovered: vi.fn(), onDiscardRecovered: vi.fn(), onChooseConflict: vi.fn(),
  onCancelConflict: vi.fn(), onConfirmLoadLatest: vi.fn(), onConfirmSaveOver: vi.fn(),
});
const show = (state, extra = {}) => render(<MyCardNotices state={{ ...initialMyCardState, load: 'ready', ...state }} choices={NO_CHOICES} {...handlers()} {...extra} />);

describe('a photo the tab will not keep', () => {
  it('is said, as it happens, and what to do about it', () => {
    show({ photoKept: false });
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('Your new photo isn\'t being kept');
    expect(note).toHaveTextContent('If you leave or reload this page before you save, it will be lost. Press Save to keep it.');
    expect(screen.getByRole('heading', { level: 2, name: 'Your new photo isn\'t being kept' })).toBeInTheDocument();
  });

  it('is not said when it is kept, or when there is no photo to keep', () => {
    show({ photoKept: true });
    expect(screen.queryByText(/isn't being kept/)).toBeNull();
  });
});

describe('a photo that could not be restored', () => {
  const recovered = { savedAt: 1700, baseRevision: 3, photoLost: true };

  it('is said with the restored changes, beside Discard and OK', () => {
    show({ recovered });
    expect(screen.getByText('We restored the changes you hadn\'t saved')).toBeInTheDocument();
    expect(screen.getByText('Your uploaded photo couldn\'t be restored. Choose it again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard changes' })).toBeInTheDocument();
  });

  it('is said when a conflict is on screen too, in its plain note', () => {
    show({ recovered, conflict: { current: { status: 'ok', card: {}, revision: 5 }, changes: [], confirm: null, renewed: false } }, { changeLabels: ['Title'] });
    expect(screen.getByText(/We restored the changes you hadn't saved\. Your uploaded photo couldn't be restored\. Choose it again\./)).toBeInTheDocument();
  });

  it('is not said when nothing was lost', () => {
    show({ recovered: { savedAt: 1700, baseRevision: 3 } });
    expect(screen.queryByText(/couldn't be restored/)).toBeNull();
    expect(screen.getByText('We restored the changes you hadn\'t saved')).toBeInTheDocument();
  });
});

describe('what they say', () => {
  it('never contains a picture: the words are fixed', () => {
    const photo = photoDataUrl(320, 36_000);
    const { container } = show({ photoKept: false, recovered: { savedAt: 1700, baseRevision: 3, photoLost: true } });
    expect(container.textContent).not.toContain(fingerprintOf(photo));
    expect(container.textContent).not.toMatch(/data:image|base64/);
  });
});
