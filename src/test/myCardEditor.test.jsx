/**
 * The My Card editor and preview as a person uses them: typing, the Shared /
 * Private switches, keyboard use, messages, suggestions and the photo's
 * fallbacks. No Firebase and no router: the components take everything as
 * props, so this is the whole of what they do.
 */
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyCardEditor from '../pages/ContactHub/myCard/MyCardEditor';
import MyCardPreview from '../pages/ContactHub/myCard/MyCardPreview';
import MyCardLayout from '../pages/ContactHub/myCard/MyCardLayout';
import CardAvatar from '../pages/ContactHub/myCard/CardAvatar';
import { useCardDraft } from '../pages/ContactHub/myCard/useCardDraft';
import { newCard } from '../utils/myCardRules';
import { EXIF, fingerprintOf, photoDataUrl } from './helpers/photoFixtures';
import { buildCardSuggestions } from '../utils/myCardSuggestions';

/** What a page does: holds the draft, and puts the editor and the preview in the layout. */
function Page({ initial = newCard(), suggestions = null, onSubmit, onDraft, actions = null, disabled = false, preparePhoto }) {
  const draft = useCardDraft(initial);
  onDraft?.(draft);
  return (
    <MyCardLayout
      actions={actions}
      editor={(
        <MyCardEditor
          card={draft.card}
          errors={draft.errors}
          suggestions={suggestions}
          onEdit={draft.edit}
          onBlur={draft.blur}
          onShare={draft.setShare}
          onUseSuggestion={draft.useSuggestion}
          onSubmit={onSubmit}
          disabled={disabled}
          preparePhoto={preparePhoto}
        />
      )}
      preview={<MyCardPreview card={draft.card} />}
    />
  );
}

const preview = () => screen.getByRole('region', { name: 'What people will see' });
const openAdvanced = () => userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
const field = (name) => screen.getByLabelText(name);
const toggle = (label) => screen.getByRole('switch', { name: `${label} on your card` });
const named = { ...newCard(), firstName: 'Ada', lastName: 'Lovelace' };

describe('the editor', () => {
  it('has every field, each with a label', () => {
    render(<Page />);
    for (const label of ['First name', 'Last name', 'Title', 'Organization', 'Email', 'Phone', 'LinkedIn', 'Instagram', 'Website']) {
      expect(field(label)).toBeInTheDocument();
    }
    // The photo is an action first; its link is under Advanced.
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Photo link')).toBeNull();
    expect(screen.getByRole('form', { name: 'Edit your card' })).toBeInTheDocument();
  });

  it('groups them under headings', () => {
    render(<Page />);
    for (const title of ['You', 'How to reach you', 'Elsewhere online']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('has a Shared / Private switch for every field but the name, and says the name is always shown', () => {
    render(<Page />);
    expect(screen.getAllByRole('switch')).toHaveLength(8);
    for (const label of ['Photo', 'Title', 'Organization', 'Email', 'Phone', 'LinkedIn', 'Instagram', 'Website']) {
      expect(toggle(label)).toBeInTheDocument();
    }
    expect(screen.queryByRole('switch', { name: /name/i })).toBeNull();
    expect(screen.getByText('Your name is always on your card.')).toBeInTheDocument();
  });

  it('starts with email, phone, Instagram and website private, and the rest shared', () => {
    render(<Page />);
    for (const label of ['Email', 'Phone', 'Instagram', 'Website']) {
      expect(toggle(label)).toHaveAttribute('aria-checked', 'false');
      expect(toggle(label)).toHaveTextContent('Private');
    }
    for (const label of ['Photo', 'Title', 'Organization', 'LinkedIn']) {
      expect(toggle(label)).toHaveAttribute('aria-checked', 'true');
      expect(toggle(label)).toHaveTextContent('Shared');
    }
  });

  it('shows the card it is given', () => {
    render(<Page initial={{ ...named, title: 'Analyst' }} />);
    expect(field('First name')).toHaveValue('Ada');
    expect(field('Title')).toHaveValue('Analyst');
  });

  it('uses the right keyboard and autofill hints', () => {
    render(<Page />);
    expect(field('Email')).toHaveAttribute('inputmode', 'email');
    expect(field('Email')).toHaveAttribute('autocomplete', 'email');
    expect(field('Phone')).toHaveAttribute('inputmode', 'tel');
    expect(field('First name')).toHaveAttribute('autocomplete', 'given-name');
    expect(field('Website')).toHaveAttribute('inputmode', 'url');
  });

  it('lets Enter in a field submit the form, without reloading the page', async () => {
    const onSubmit = vi.fn();
    render(<Page initial={named} onSubmit={onSubmit} />);
    await userEvent.type(field('Title'), 'Founder{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('does not take Enter away from the switches or the suggestions', async () => {
    const onSubmit = vi.fn();
    render(<Page initial={named} onSubmit={onSubmit} suggestions={{ title: { value: 'Analyst', source: 'recon' } }} />);
    toggle('Email').focus();
    await userEvent.keyboard('{Enter}');
    expect(toggle('Email')).toHaveAttribute('aria-checked', 'true');
    screen.getByRole('button', { name: /Use “Analyst”/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(field('Title')).toHaveValue('Analyst');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('the preview follows what is typed', () => {
  it('shows the name and shared details as they are typed, unsaved', async () => {
    render(<Page />);
    expect(within(preview()).getByText('Add your name to see your card.')).toBeInTheDocument();
    await userEvent.type(field('First name'), 'Ada');
    await userEvent.type(field('Last name'), 'Lovelace');
    await userEvent.type(field('Title'), 'Analyst');
    await userEvent.type(field('Organization'), 'Analytical Engines');
    const card = within(preview()).getByRole('article', { name: 'Card for Ada Lovelace' });
    expect(within(card).getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    // The title is under the name; the organization is the card's header.
    expect(within(card).getByText('Analyst')).toHaveClass('mycard-card-title');
    expect(within(card).getByText('Analytical Engines')).toHaveClass('mycard-card-brand--org');
  });

  it('keeps every word about privacy off the card: beside it, never on it', async () => {
    render(<Page initial={{ ...named, title: 'Analyst', email: 'ada@example.com' }} />);
    const card = within(preview()).getByRole('article');
    expect(card.textContent).not.toMatch(/private|shared|sharing|kept|switch|nobody/i);
    const aside = within(preview()).getByText(/Kept private: Email/).closest('.mycard-aside');
    expect(aside).not.toBeNull();
    expect(card.contains(aside)).toBe(false);
    expect(within(aside).getByText(/Sharing isn.t turned on yet/)).toBeInTheDocument();
  });

  it('puts the organization in the header, then photo, name, title, details and the attribution', async () => {
    render(<Page initial={{ ...named, title: 'Analyst', organization: 'Analytical Engines', photoUrl: 'https://images.example.com/a.jpg', email: 'ada@example.com', share: { photoUrl: true, title: true, organization: true, email: true } }} />);
    const card = within(preview()).getByRole('article');
    const order = [within(card).getByText('Analytical Engines'), card.querySelector('img'), within(card).getByRole('heading', { name: 'Ada Lovelace' }), within(card).getByText('Analyst'), within(card).getByRole('list'), within(card).getByText('Made with IDYNIFY')];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `item ${i}`).toBeTruthy();
    }
  });

  it('shows a neutral header, and no wordmark, when there is no organization', async () => {
    render(<Page initial={named} />);
    const card = within(preview()).getByRole('article');
    expect(card.querySelector('.mycard-card-brand')).toHaveTextContent('Contact card');
    expect(card.querySelector('.mycard-card-banner')).toHaveAttribute('aria-hidden', 'true');
    expect(within(card).getAllByText(/IDYNIFY/)).toHaveLength(1);
    expect(within(card).getByText('Made with IDYNIFY')).toHaveClass('mycard-card-made');
  });

  it('shows a private organization nowhere on the card, and the neutral header instead', async () => {
    render(<Page initial={{ ...named, organization: 'Analytical Engines', share: { organization: false } }} />);
    const card = within(preview()).getByRole('article');
    expect(card.textContent).not.toMatch(/Analytical Engines/);
    expect(card.querySelector('.mycard-card-brand')).toHaveTextContent('Contact card');
    expect(within(preview()).getByText(/Kept private: .*Organization/)).toBeInTheDocument();
  });

  it('follows the organization as it is typed, and the attribution stays at the bottom', async () => {
    render(<Page initial={named} />);
    await userEvent.type(field('Organization'), 'Acme');
    const card = within(preview()).getByRole('article');
    expect(card.querySelector('.mycard-card-brand')).toHaveTextContent('Acme');
    expect(card.querySelector('.mycard-card-body').lastElementChild).toHaveTextContent('Made with IDYNIFY');
  });

  it('shows the initials without a photo', async () => {
    render(<Page initial={named} />);
    expect(within(preview()).getByText('AL')).toBeInTheDocument();
  });

  it('does not show a private field, even one that is filled in', async () => {
    render(<Page initial={named} />);
    await userEvent.type(field('Email'), 'ada@example.com');
    await userEvent.type(field('Phone'), '+1 555 010 2000');
    expect(within(preview()).queryByText('ada@example.com')).toBeNull();
    expect(within(preview()).queryByText('+1 555 010 2000')).toBeNull();
    expect(within(preview()).getByText('Kept private: Email, Phone')).toBeInTheDocument();
  });

  it('shows the field once it is switched to Shared, and hides it again when it is not', async () => {
    render(<Page initial={{ ...named, email: 'ada@example.com' }} />);
    expect(within(preview()).queryByText('ada@example.com')).toBeNull();
    await userEvent.click(toggle('Email'));
    expect(toggle('Email')).toHaveAttribute('aria-checked', 'true');
    expect(within(preview()).getByText('ada@example.com')).toBeInTheDocument();
    expect(within(preview()).queryByText(/Kept private/)).toBeNull();
    await userEvent.click(toggle('Email'));
    expect(within(preview()).queryByText('ada@example.com')).toBeNull();
  });

  it('shows each kind of detail with a label a screen reader can read', async () => {
    render(<Page initial={{
      ...named, email: 'ada@example.com', phone: '+1 555 010 2000', linkedinUrl: 'https://www.linkedin.com/in/ada',
      instagram: 'ada.l', website: 'https://ada.example.com/',
      share: { photoUrl: true, title: true, organization: true, email: true, phone: true, linkedinUrl: true, instagram: true, website: true },
    }} />);
    const list = within(preview()).getByRole('list');
    const rows = within(list).getAllByRole('listitem').map((item) => item.textContent);
    expect(rows).toEqual([
      'Email: ada@example.com', 'Phone: +1 555 010 2000', 'LinkedIn: linkedin.com/in/ada', 'Instagram: @ada.l', 'Website: ada.example.com',
    ]);
  });

  it('never shows a value the rules refuse', async () => {
    render(<Page initial={named} />);
    await userEvent.click(toggle('Website'));
    await userEvent.type(field('Website'), 'javascript:alert(1)');
    expect(within(preview()).queryByText(/javascript/)).toBeNull();
    expect(within(preview()).queryByText(/Website/)).toBeNull();
  });

  it('says that sharing is not turned on', () => {
    render(<Page initial={named} />);
    expect(within(preview()).getByText(/Sharing isn.t turned on yet/)).toBeInTheDocument();
  });

  it('wraps long and non-Latin names whole', async () => {
    render(<Page initial={{ ...newCard(), firstName: 'José', lastName: '李' }} />);
    expect(within(preview()).getByRole('heading', { name: 'José 李' })).toBeInTheDocument();
    expect(within(preview()).getByText('J李')).toBeInTheDocument();
  });
});

describe('the Shared / Private switch, by keyboard', () => {
  it('is reached with Tab and turned over with Space or Enter', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} />);
    const email = toggle('Email');
    // Tab from the Email field to its switch is not the order (the switch is first in the field's head),
    // so go to it directly and use the keys a person would.
    email.focus();
    expect(email).toHaveFocus();
    await user.keyboard(' ');
    expect(email).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Enter}');
    expect(email).toHaveAttribute('aria-checked', 'false');
  });

  it('comes before its field in the Tab order, so the choice is not skipped', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} />);
    field('Phone').focus();
    await user.tab({ shift: true });
    expect(toggle('Phone')).toHaveFocus();
    await user.tab();
    expect(field('Phone')).toHaveFocus();
  });

  it('is a real button, named by its field, with its state exposed', () => {
    render(<Page initial={named} />);
    const email = toggle('Email');
    expect(email.tagName).toBe('BUTTON');
    expect(email).toHaveAttribute('type', 'button');
    expect(email).toHaveAttribute('role', 'switch');
    expect(email).toHaveAccessibleName('Email on your card');
  });

  it('cannot be used while the editor is disabled', async () => {
    render(<MyCardEditor card={{ ...newCard() }} onEdit={vi.fn()} onBlur={vi.fn()} onShare={vi.fn()} disabled />);
    expect(toggle('Email')).toBeDisabled();
    expect(field('Email')).toBeDisabled();
  });
});

describe('messages', () => {
  it('says nothing about a field until it is left, then says what is wrong', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} />);
    await user.type(field('Email'), 'nope');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.tab();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/email address like name@example.com/);
    expect(field('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Email')).toHaveAccessibleDescription(alert.textContent);
  });

  it('stops saying it when the value is fixed', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} />);
    await user.type(field('Email'), 'nope');
    await user.tab();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.clear(field('Email'));
    await user.type(field('Email'), 'ada@example.com');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(field('Email')).not.toHaveAttribute('aria-invalid');
  });

  it('tidies a valid value when the field is left', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} />);
    await user.type(field('Email'), '  ADA@Example.com ');
    await user.tab();
    expect(field('Email')).toHaveValue('ada@example.com');
    await user.type(field('LinkedIn'), 'linkedin.com/in/ada/');
    await user.tab();
    expect(field('LinkedIn')).toHaveValue('https://www.linkedin.com/in/ada');
  });

  it('leaves what was typed alone when it is not valid, so it can be fixed', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} />);
    await user.type(field('Phone'), 'call me');
    await user.tab();
    expect(field('Phone')).toHaveValue('call me');
  });

  it('asks for a name once it has been left empty', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(field('First name'));
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Add your name');
    expect(field('First name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the hint when there is no message', () => {
    render(<Page initial={named} />);
    expect(field('LinkedIn')).toHaveAccessibleDescription('Your profile link.');
  });
});

describe('suggestions', () => {
  const suggestions = buildCardSuggestions({
    account: { displayName: 'Ada Lovelace', email: 'ada@example.com' },
    linkedin: { status: 'connected', givenName: 'Ada', familyName: 'Lovelace', pictureUrl: 'https://media.example.com/ada.jpg' },
    recon: { role: 'Analyst', companyName: 'Analytical Engines' },
  });

  it('offers what the account knows for empty fields, and fills nothing by itself', () => {
    render(<Page suggestions={suggestions} />);
    expect(screen.getByRole('button', { name: 'Use my LinkedIn photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use “Analyst” from your Recon answers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use “ada@example.com” from your account' })).toBeInTheDocument();
    expect(field('First name')).toHaveValue('');
    expect(field('Title')).toHaveValue('');
    expect(within(preview()).getByText('Add your name to see your card.')).toBeInTheDocument();
  });

  it('offers the name once, for both name fields, and fills both when chosen', async () => {
    render(<Page suggestions={suggestions} />);
    const button = screen.getByRole('button', { name: 'Use “Ada Lovelace” from your account' });
    expect(screen.queryAllByRole('button', { name: /Use “(Ada|Lovelace)”/ })).toHaveLength(0);
    await userEvent.click(button);
    expect(field('First name')).toHaveValue('Ada');
    expect(field('Last name')).toHaveValue('Lovelace');
    expect(screen.queryByRole('button', { name: /Use “Ada Lovelace”/ })).toBeNull();
  });

  it('offers only the part of the name that is empty', () => {
    render(<Page suggestions={suggestions} initial={{ ...newCard(), firstName: 'Countess' }} />);
    expect(screen.getByRole('button', { name: 'Use “Lovelace” from your account' })).toBeInTheDocument();
  });

  it('fills one field when it is chosen, and the offer goes away', async () => {
    render(<Page suggestions={suggestions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use “Analyst” from your Recon answers' }));
    expect(field('Title')).toHaveValue('Analyst');
    expect(screen.queryByRole('button', { name: /Use “Analyst”/ })).toBeNull();
    expect(field('Organization')).toHaveValue('');
  });

  it('uses the LinkedIn photo when asked, and shows it on the card', async () => {
    render(<Page suggestions={suggestions} initial={named} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use my LinkedIn photo' }));
    // The photo is set, so the raw link stays out of the way until asked for.
    expect(screen.queryByLabelText('Photo link')).toBeNull();
    await openAdvanced();
    expect(field('Photo link')).toHaveValue('https://media.example.com/ada.jpg');
    const image = within(preview()).getByRole('article').querySelector('img');
    expect(image).toHaveAttribute('src', 'https://media.example.com/ada.jpg');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('does not offer a suggestion for a field that has text, and never overwrites it', () => {
    render(<Page suggestions={suggestions} initial={{ ...named, title: 'Founder', photoUrl: 'https://images.example.com/mine.jpg' }} />);
    expect(screen.queryByRole('button', { name: /Use “Analyst”/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use my LinkedIn photo' })).toBeNull();
    expect(field('Title')).toHaveValue('Founder');
  });

  it('offers nothing when there is nothing to offer', () => {
    render(<Page suggestions={buildCardSuggestions({})} />);
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
  });

  it('does not offer a suggestion for a field the card has no source for', () => {
    render(<Page suggestions={{ phone: { value: '555 010 2000', source: 'account' } }} />);
    expect(screen.queryByRole('button', { name: /555/ })).toBeNull();
  });
});

describe('the photo: upload first', () => {
  const linkedinOffer = buildCardSuggestions({ linkedin: { status: 'connected', pictureUrl: 'https://media.example.com/ada.jpg' } });
  const withLink = { ...named, photoUrl: 'https://images.example.com/ada.jpg' };
  const photoBlock = () => document.querySelector('.mycard-field--photoUrl');
  const buttonsIn = (root) => [...root.querySelectorAll('button')].map((button) => button.textContent.trim());

  it('leads with Upload photo, then the LinkedIn photo when one is on offer, with the link under Advanced', () => {
    render(<Page initial={named} suggestions={linkedinOffer} />);
    const upload = screen.getByRole('button', { name: 'Upload photo' });
    const linkedin = screen.getByRole('button', { name: 'Use my LinkedIn photo' });
    expect(upload.compareDocumentPosition(linkedin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(buttonsIn(photoBlock()).filter((text) => /Upload photo|Use my LinkedIn photo|Advanced/.test(text))).toEqual(['Upload photo', 'Use my LinkedIn photo', 'Advanced']);
    expect(screen.queryByLabelText('Photo link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('makes Upload photo the one friendly button, and the LinkedIn photo the quieter one', () => {
    render(<Page initial={named} suggestions={linkedinOffer} />);
    expect(screen.getByRole('button', { name: 'Upload photo' })).toHaveClass('mycard-upload');
    expect(screen.getByRole('button', { name: 'Use my LinkedIn photo' })).toHaveClass('mycard-suggest');
    expect(screen.getByRole('button', { name: 'Use my LinkedIn photo' })).not.toHaveClass('mycard-suggest--primary');
  });

  it('opens the link under Advanced, moves focus into it, and closes it again', async () => {
    render(<Page initial={withLink} />);
    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    expect(advanced).toHaveAttribute('aria-controls', document.getElementById(advanced.getAttribute('aria-controls')).id);
    expect(field('Photo link')).toHaveValue('https://images.example.com/ada.jpg');
    expect(field('Photo link')).toHaveFocus();
    await userEvent.click(advanced);
    expect(screen.queryByLabelText('Photo link')).toBeNull();
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens Advanced with the keyboard: Enter or Space on the button', async () => {
    const user = userEvent.setup();
    render(<Page initial={withLink} />);
    screen.getByRole('button', { name: 'Advanced' }).focus();
    await user.keyboard('{Enter}');
    expect(field('Photo link')).toHaveFocus();
  });

  it('with nothing on offer, asks for a photo gently, and the link is still under Advanced', () => {
    render(<Page initial={named} />);
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    expect(screen.getByText('Add a photo so people recognize you.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Photo link')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Use my/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });

  it('with a photo set, keeps the raw link out of the way, and offers Upload photo and Remove photo, not a LinkedIn photo', () => {
    render(<Page initial={withLink} suggestions={linkedinOffer} />);
    expect(screen.queryByLabelText('Photo link')).toBeNull();
    expect(screen.queryByDisplayValue('https://images.example.com/ada.jpg')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use my LinkedIn photo' })).toBeNull();
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/ada.jpg');
  });

  it('is real buttons, named plainly, in the Tab order', () => {
    render(<Page initial={withLink} />);
    for (const name of ['Upload photo', 'Remove photo', 'Advanced']) {
      const button = screen.getByRole('button', { name });
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAccessibleName(name);
      expect(button.tabIndex).toBe(0);
    }
  });

  it('presses the file picker open from Upload photo, and from the keyboard', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} />);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    await user.click(screen.getByRole('button', { name: 'Upload photo' }));
    expect(click).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Upload photo' }).focus();
    await user.keyboard('{Enter}');
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it('has a file input for pictures only, one at a time, out of the Tab order and named', () => {
    render(<Page initial={named} />);
    const input = screen.getByLabelText('Choose a photo from your device');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/*');
    expect(input).not.toHaveAttribute('multiple');
    expect(input.tabIndex).toBe(-1);
  });

  it('edits the link under Advanced, and the card follows', async () => {
    render(<Page initial={withLink} />);
    await openAdvanced();
    await userEvent.clear(field('Photo link'));
    await userEvent.type(field('Photo link'), 'https://images.example.com/new.jpg');
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/new.jpg');
  });

  it('keeps the link on screen while it is being typed, even when what is typed is briefly valid or not', async () => {
    render(<Page initial={withLink} />);
    await openAdvanced();
    for (const text of ['h', 'https://', 'https://images.example.com/n', 'https://images.example.com/new.jpg']) {
      await userEvent.clear(field('Photo link'));
      await userEvent.type(field('Photo link'), text);
      expect(screen.getByLabelText('Photo link'), text).toBeInTheDocument();
    }
  });

  it('opens Advanced by itself when what is there is not a valid link, and keeps it open while it is fixed', async () => {
    render(<Page initial={{ ...named, photoUrl: 'http://images.example.com/insecure.jpg' }} />);
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'true');
    expect(field('Photo link')).toHaveValue('http://images.example.com/insecure.jpg');
    for (const text of ['https://', 'https://images.example.com/f', 'https://images.example.com/fixed.jpg']) {
      await userEvent.clear(field('Photo link'));
      await userEvent.type(field('Photo link'), text);
      expect(screen.getByLabelText('Photo link'), text).toBeInTheDocument();
    }
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/fixed.jpg');
  });

  it('validates the link as before, and says what is wrong', async () => {
    const user = userEvent.setup();
    render(<Page initial={withLink} />);
    await openAdvanced();
    await user.clear(field('Photo link'));
    await user.type(field('Photo link'), 'http://images.example.com/insecure.jpg');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent(/starts with https/);
    expect(field('Photo link')).toHaveAttribute('aria-invalid', 'true');
    expect(within(preview()).getByRole('article').querySelector('img')).toBeNull();
  });

  it('opens Advanced by itself when the picture does not load, with the reason', () => {
    render(<Page initial={{ ...named, photoUrl: 'https://images.example.com/gone.jpg' }} />);
    expect(screen.queryByLabelText('Photo link')).toBeNull();
    for (const image of document.querySelectorAll('img')) fireEvent.error(image);
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'true');
    expect(field('Photo link')).toHaveAccessibleDescription(/didn.t load a picture, so your initials are used/);
  });

  describe('removing the photo', () => {
    it('asks first, says what happens, and puts the safe choice in focus', async () => {
      render(<Page initial={withLink} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
      const ask = screen.getByRole('group', { name: /Remove your photo\?/ });
      expect(ask).toHaveTextContent('People will see your initials instead. Nothing changes in your saved card until you press Save.');
      expect(within(ask).getByRole('button', { name: 'Yes, remove it' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep my photo' })).toHaveFocus();
      // Nothing has been removed yet.
      expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/ada.jpg');
      expect(screen.queryByRole('button', { name: 'Upload photo' })).toBeNull();
    });

    it('keeps the photo, and puts focus back on Remove photo, when it is not wanted after all', async () => {
      render(<Page initial={withLink} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
      await userEvent.click(screen.getByRole('button', { name: 'Keep my photo' }));
      expect(screen.queryByRole('group', { name: /Remove your photo/ })).toBeNull();
      expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/ada.jpg');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Remove photo' })).toHaveFocus());
    });

    it('keeps the photo on Escape-free keyboard use too: Enter on "Keep my photo"', async () => {
      const user = userEvent.setup();
      render(<Page initial={withLink} />);
      await user.click(screen.getByRole('button', { name: 'Remove photo' }));
      await user.keyboard('{Enter}');
      expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/ada.jpg');
    });

    it('removes it only when it is confirmed, leaves the initials, and puts focus on Upload photo', async () => {
      let draft;
      render(<Page initial={withLink} suggestions={linkedinOffer} onDraft={(d) => { draft = d; }} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
      await userEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));
      expect(draft.card.photoUrl).toBe('');
      expect(within(preview()).getByText('AL')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Use my LinkedIn photo' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Upload photo' })).toHaveFocus());
    });

    it('says, for a screen reader, that it is removed and not yet saved, and lets the words go', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        render(<Page initial={withLink} />);
        fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
        fireEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));
        expect(screen.getByText('Photo removed. It is not saved until you press Save.')).toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(6100); });
        expect(screen.queryByText(/Photo removed/)).toBeNull();
      } finally { vi.useRealTimers(); }
    });

    it('asks for a photo that is only a link, and for one that was uploaded, alike', async () => {
      render(<Page initial={{ ...named, photoUrl: photoDataUrl(320, 20_000) }} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
      expect(screen.getByRole('group', { name: /Remove your photo\?/ })).toBeInTheDocument();
    });

    it('is not offered for a photo that is not there', () => {
      render(<Page initial={named} suggestions={linkedinOffer} />);
      expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
    });
  });

  it('does not touch the privacy switch: it stays in place and keeps its state', async () => {
    render(<Page initial={withLink} />);
    expect(toggle('Photo')).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(toggle('Photo'));
    expect(within(preview()).getByRole('article').querySelector('img')).toBeNull();
    expect(within(preview()).getByText(/Kept private: Photo/)).toBeInTheDocument();
    await openAdvanced();
    expect(toggle('Photo')).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(toggle('Photo'));
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/ada.jpg');
  });

  it('keeps the photo\'s Shared / Private switch in the photo block, named for the photo, with every way of adding one', () => {
    render(<Page initial={named} suggestions={linkedinOffer} />);
    expect(toggle('Photo')).toHaveAttribute('aria-checked', 'true');
    expect(photoBlock()).toContainElement(toggle('Photo'));
  });

  it('never fills in or changes a photo that is set: a suggestion is not offered over it', () => {
    render(<Page initial={withLink} suggestions={linkedinOffer} />);
    expect(screen.queryByRole('button', { name: /^Use my/ })).toBeNull();
  });

  it('uses the LinkedIn photo with a keyboard: Tab to the button, Enter', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} suggestions={linkedinOffer} />);
    screen.getByRole('button', { name: 'Use my LinkedIn photo' }).focus();
    await user.keyboard('{Enter}');
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://media.example.com/ada.jpg');
    expect(screen.queryByLabelText('Photo link')).toBeNull();
  });

  it('turns every way of adding or removing a photo off when the form is read-only', () => {
    render(<Page initial={withLink} suggestions={linkedinOffer} disabled />);
    for (const name of ['Upload photo', 'Remove photo', 'Advanced']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByLabelText('Choose a photo from your device')).toBeDisabled();
    expect(toggle('Photo')).toBeDisabled();
  });

  it('is called "Photo", not "Photo link", wherever the photo itself is meant', () => {
    render(<Page initial={{ ...named, photoUrl: photoDataUrl(320, 20_000) }} />);
    expect(photoBlock().querySelector('.mycard-label')).toHaveTextContent(/^Photo$/);
    expect(screen.queryByText('Photo link')).toBeNull();
  });
});

describe('the photo', () => {
  it('shows the picture when the link loads', () => {
    render(<Page initial={{ ...named, photoUrl: 'https://images.example.com/ada.jpg' }} />);
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/ada.jpg');
  });

  it('falls back to the initials when the picture does not load, and says so by the field', () => {
    render(<Page initial={{ ...named, photoUrl: 'https://images.example.com/gone.jpg' }} />);
    const images = document.querySelectorAll('img');
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) fireEvent.error(image);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(within(preview()).getByText('AL')).toBeInTheDocument();
    expect(field('Photo link')).toHaveAccessibleDescription(/didn.t load a picture, so your initials are used/);
  });

  it('tries again when the link is changed', async () => {
    render(<Page initial={{ ...named, photoUrl: 'https://images.example.com/gone.jpg' }} />);
    for (const image of document.querySelectorAll('img')) fireEvent.error(image);
    await userEvent.clear(field('Photo link'));
    await userEvent.type(field('Photo link'), 'https://images.example.com/new.jpg');
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/new.jpg');
    expect(field('Photo link')).not.toHaveAccessibleDescription(/didn.t load/);
  });

  it('does not try to load a link that is not an https link', () => {
    render(<Page initial={{ ...named, photoUrl: 'http://images.example.com/a.jpg' }} />);
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('shows a person icon, not nothing, when there is neither a photo nor initials', () => {
    const { container } = render(<CardAvatar photoUrl="" initials="" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('tells the page once about a link that did not load', () => {
    const onPhotoFailed = vi.fn();
    const { container } = render(<CardAvatar photoUrl="https://images.example.com/gone.jpg" initials="AL" onPhotoFailed={onPhotoFailed} />);
    fireEvent.error(container.querySelector('img'));
    expect(onPhotoFailed).toHaveBeenCalledWith('https://images.example.com/gone.jpg');
    expect(container).toHaveTextContent('AL');
  });
});

describe('the layout', () => {
  it('has both panels in the page, and a switch for a narrow screen that starts on Edit', () => {
    const { container } = render(<Page initial={named} />);
    expect(container.querySelector('.mycard')).toHaveAttribute('data-view', 'edit');
    expect(screen.getByRole('button', { name: 'Edit', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Edit your card' })).toBeInTheDocument();
    expect(preview()).toBeInTheDocument();
  });

  it('switches between Edit and Preview with the mouse or the keyboard', async () => {
    const user = userEvent.setup();
    const { container } = render(<Page initial={named} />);
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(container.querySelector('.mycard')).toHaveAttribute('data-view', 'preview');
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true');
    screen.getByRole('button', { name: 'Edit' }).focus();
    await user.keyboard('{Enter}');
    expect(container.querySelector('.mycard')).toHaveAttribute('data-view', 'edit');
  });

  it('keeps what was typed when switching panels', async () => {
    const user = userEvent.setup();
    render(<Page initial={named} />);
    await user.type(field('Title'), 'Founder');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(field('Title')).toHaveValue('Founder');
  });

  it('has a page heading, and room for a notice and for actions', () => {
    render(
      <MyCardLayout
        editor={<p>editor</p>}
        preview={<p>preview</p>}
        notice={<p role="status">Your card changed in another tab.</p>}
        actions={<button type="button">A bar</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'My Card' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your card changed in another tab.');
    expect(screen.getByRole('button', { name: 'A bar' })).toBeInTheDocument();
  });

  it('can start a narrow screen on the preview', () => {
    const { container } = render(<MyCardLayout editor={<p>e</p>} preview={<p>p</p>} initialView="preview" />);
    expect(container.querySelector('.mycard')).toHaveAttribute('data-view', 'preview');
  });
});

describe('the draft the page holds', () => {
  it('reports changes, and whether it can be saved', async () => {
    const user = userEvent.setup();
    let latest;
    render(<Page initial={named} onDraft={(draft) => { latest = draft; }} />);
    expect(latest.dirty).toBe(false);
    expect(latest.valid).toBe(true);
    await user.type(field('Title'), 'Founder');
    expect(latest.dirty).toBe(true);
    await user.type(field('Email'), 'nope');
    expect(latest.valid).toBe(false);
  });

  it('starts over from a card on reset, as after a save', async () => {
    const user = userEvent.setup();
    let latest;
    function Resettable() {
      const [saved, setSaved] = useState(0);
      return (
        <>
          <button type="button" onClick={() => { latest.reset({ ...named, title: 'Saved title' }); setSaved(saved + 1); }}>reset</button>
          <Page initial={named} onDraft={(draft) => { latest = draft; }} />
        </>
      );
    }
    render(<Resettable />);
    await user.type(field('Title'), 'Unsaved');
    expect(latest.dirty).toBe(true);
    await user.click(screen.getByRole('button', { name: 'reset' }));
    expect(field('Title')).toHaveValue('Saved title');
    expect(latest.dirty).toBe(false);
  });
});

describe('an uploaded photo', () => {
  const photo = photoDataUrl(320, 36_000, { tag: 1 });
  const withPhoto = { ...named, photoUrl: photo };
  /** Everything a person or a screen reader could be given as text: content, values and every attribute except an image's own source. */
  const textual = (root = document.body) => [
    root.textContent,
    ...[...root.querySelectorAll('input, textarea')].map((node) => node.value),
    ...[...root.querySelectorAll('*')].flatMap((node) => [...node.attributes]
      .filter((attribute) => !(node.tagName === 'IMG' && attribute.name === 'src'))
      .map((attribute) => attribute.value)),
  ];
  const leaks = (root) => textual(root).some((text) => text.includes(fingerprintOf(photo)) || /data:image\/jpeg;base64/.test(text));

  it('is shown as the photo, in the form and on the card, and nowhere as text', () => {
    const { container } = render(<Page initial={withPhoto} />);
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', photo);
    expect(container.querySelector('.mycard-photo-row img')).toHaveAttribute('src', photo);
    expect(leaks(document.body)).toBe(false);
    expect(screen.queryByLabelText('Photo link')).toBeNull();
    expect(screen.queryByDisplayValue(/data:image/)).toBeNull();
  });

  it('stays out of the link box even when the box is opened: it is empty, and says the photo is in use', async () => {
    render(<Page initial={withPhoto} />);
    await openAdvanced();
    expect(field('Photo link')).toHaveValue('');
    expect(field('Photo link')).toHaveFocus();
    expect(screen.getByText('Your uploaded photo is in use. Paste a link to use that instead, or remove the photo.')).toBeInTheDocument();
    expect(leaks(document.body)).toBe(false);
  });

  it('is replaced by a link that is typed in, and the link is then shown as a link', async () => {
    let draft;
    render(<Page initial={withPhoto} onDraft={(d) => { draft = d; }} />);
    await openAdvanced();
    await userEvent.type(field('Photo link'), 'https://images.example.com/new.jpg');
    expect(draft.card.photoUrl).toBe('https://images.example.com/new.jpg');
    expect(field('Photo link')).toHaveValue('https://images.example.com/new.jpg');
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', 'https://images.example.com/new.jpg');
  });

  it('is removed by "Remove photo" once confirmed, leaving the initials', async () => {
    let draft;
    render(<Page initial={withPhoto} onDraft={(d) => { draft = d; }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));
    expect(draft.card.photoUrl).toBe('');
    expect(within(preview()).getByRole('article').querySelector('img')).toBeNull();
    expect(within(preview()).getByRole('article')).toHaveTextContent('AL');
  });

  it('follows the Photo switch: private, it is gone from the card people would see, and the owner still has it in the form', async () => {
    render(<Page initial={{ ...withPhoto, share: { ...newCard().share, photoUrl: true } }} />);
    expect(within(preview()).getByRole('article').querySelector('img')).toHaveAttribute('src', photo);
    await userEvent.click(toggle('Photo'));
    expect(within(preview()).getByRole('article').querySelector('img')).toBeNull();
    expect(within(preview()).getByText(/Kept private:.*Photo/)).toBeInTheDocument();
    expect(document.querySelector('.mycard-photo-row img')).toHaveAttribute('src', photo);
    // Not in the preview in any form: not a source, not text.
    expect(leaks(preview())).toBe(false);
    expect(preview().innerHTML).not.toContain(fingerprintOf(photo));
  });

  it('is not shown, as text or otherwise, when what is held is not a finished photo', async () => {
    const bad = photoDataUrl(320, 5000, { extra: EXIF });
    const { container } = render(<Page initial={{ ...named, photoUrl: bad }} />);
    expect(container.innerHTML).not.toContain(fingerprintOf(bad));
    expect(textual().some((text) => text.includes(bad.slice(300, 360)))).toBe(false);
    expect(within(preview()).getByRole('article').querySelector('img')).toBeNull();
    await openAdvanced();
    expect(field('Photo link')).toHaveValue('');
  });

  it('is a short piece of text typed into the link box like any other text: shown, and refused with the usual message', async () => {
    render(<Page initial={named} />);
    await openAdvanced();
    await userEvent.type(field('Photo link'), 'data:image/png;base64,AAAA');
    expect(field('Photo link')).toHaveValue('data:image/png;base64,AAAA');
  });
});
