/**
 * The crop dialog and the photo part of the form, as a person uses them: pick a
 * picture, move and zoom it, use it or leave. The photo utility is replaced by
 * a stand-in that records what it is asked for (the crop), so every number the
 * dialog works out can be checked exactly; the real utility has its own tests
 * and its own browser checks.
 *
 * jsdom does no layout, so the picture's size and the picture area's size are
 * given to it, and what the dialog does with them is what is checked.
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhotoCropDialog from '../pages/ContactHub/myCard/PhotoCropDialog';
import MyCardEditor from '../pages/ContactHub/myCard/MyCardEditor';
import MyCardPreview from '../pages/ContactHub/myCard/MyCardPreview';
import MyCardLayout from '../pages/ContactHub/myCard/MyCardLayout';
import { useCardDraft } from '../pages/ContactHub/myCard/useCardDraft';
import { PHOTO, PHOTO_ERRORS, PHOTO_MESSAGES, PreparePhotoError, cropRect } from '../utils/photoPrep';
import { newCard } from '../utils/myCardRules';
import { fingerprintOf, photoDataUrl } from './helpers/photoFixtures';

const NATURAL = { width: 4000, height: 3000 };
const AREA = 300;                                  // the picture area, in screen pixels

const file = (name = 'me.jpg', type = 'image/jpeg') => new File(['x'], name, { type });
const result = (tag = 1, crop = { x: 0.5, y: 0.5, zoom: 1 }) => ({ dataUrl: photoDataUrl(320, 20_000, { tag }), mimeType: 'image/jpeg', widthPx: 320, heightPx: 320, bytes: 20_000, chars: 27_000, crop, attempts: 1 });

/** A stand-in for the photo utility: answers with a photo, and remembers what it was asked. */
function fakePrepare({ failFirst = null, failNext = null, hold = null } = {}) {
  let calls = 0;
  const prepare = vi.fn(async (f, options) => {
    calls += 1;
    if (calls === 1 && failFirst) throw failFirst;
    if (calls > 1 && failNext) { const error = failNext; throw error; }
    if (calls > 1 && hold) await hold.promise;
    return result(calls, options?.crop);
  });
  return prepare;
}

const dialog = () => screen.getByRole('dialog', { name: 'Crop your photo' });
const area = () => screen.getByRole('group', { name: 'Photo position' });
const useButton = () => screen.getByRole('button', { name: /^Use photo$|^Preparing…$/ });
const slider = () => screen.getByRole('slider', { name: 'Zoom' });
const pictureOf = () => dialog().querySelector('.mycard-crop-img');

/** The picture has loaded, at this size; and the picture area has been laid out. */
async function loaded({ width = NATURAL.width, height = NATURAL.height } = {}) {
  const img = pictureOf();
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
  area().getBoundingClientRect = () => ({ width: AREA, height: AREA, left: 0, top: 0, right: AREA, bottom: AREA, x: 0, y: 0 });
  fireEvent.load(img);
  await waitFor(() => expect(useButton()).toBeEnabled());
}

const pointer = (type, element, init) => fireEvent[type](element, { pointerType: 'mouse', button: 0, pointerId: 1, ...init });
const drag = (element, from, to, id = 1) => {
  pointer('pointerDown', element, { clientX: from[0], clientY: from[1], pointerId: id });
  pointer('pointerMove', element, { clientX: to[0], clientY: to[1], pointerId: id });
  pointer('pointerUp', element, { clientX: to[0], clientY: to[1], pointerId: id });
};
const lastCrop = (prepare) => prepare.mock.calls.at(-1)[1]?.crop;
const close = (value, expected, digits = 6) => expect(value).toBeCloseTo(expected, digits);

/** Everything a person or a screen reader could be given as text, apart from an image's own source. */
const textual = () => [
  document.body.textContent,
  ...[...document.querySelectorAll('input, textarea')].map((node) => node.value),
  ...[...document.querySelectorAll('*')].flatMap((node) => [...node.attributes].filter((a) => !(node.tagName === 'IMG' && a.name === 'src')).map((a) => a.value)),
];

let revoked;
let created;
beforeEach(() => {
  created = [];
  revoked = [];
  URL.createObjectURL = vi.fn((blob) => { created.push(blob); return `blob:synthetic-${created.length}`; });
  URL.revokeObjectURL = vi.fn((url) => { revoked.push(url); });
});
afterEach(() => { vi.restoreAllMocks(); document.body.style.overflow = ''; });

function open(props = {}) {
  const handlers = { onCancel: vi.fn(), onUse: vi.fn(), ...props };
  const prepare = props.preparePhoto ?? fakePrepare();
  const view = render(<PhotoCropDialog file={props.file ?? file()} preparePhoto={prepare} {...handlers} />);
  return { ...handlers, prepare, view };
}

describe('the crop dialog', () => {
  it('is a modal dialog with a title and instructions, a square picture area, a zoom control, Cancel and Use photo', async () => {
    open();
    expect(dialog()).toHaveAttribute('aria-modal', 'true');
    expect(dialog()).toHaveAccessibleDescription(/Drag the photo to move it/);
    expect(area().tagName).toBe('DIV');
    expect(area().querySelector('.mycard-crop-guide')).toHaveAttribute('aria-hidden', 'true');
    expect(slider()).toHaveAttribute('min', '1');
    expect(slider()).toHaveAttribute('max', String(PHOTO.MAX_ZOOM));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    for (const name of ['Zoom out', 'Zoom in', 'Put the photo back']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    await loaded();
  });

  it('shows the picture it was given, and asks the photo utility about it once, for the picture as it is', async () => {
    const { prepare } = open();
    expect(pictureOf()).toHaveAttribute('src', 'blob:synthetic-1');
    await loaded();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]).toHaveLength(1);
  });

  it('waits until there is a picture to use: Use photo is off, and it says so, until the picture is ready', async () => {
    open();
    expect(useButton()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Getting your photo ready…');
    expect(slider()).toBeDisabled();
    expect(area()).toHaveAttribute('tabindex', '-1');
    await loaded();
    expect(slider()).toBeEnabled();
    expect(area()).toHaveAttribute('tabindex', '0');
    expect(screen.queryByText('Getting your photo ready…')).toBeNull();
  });

  it('puts focus in the dialog, and on the picture area once there is a picture to move', async () => {
    open();
    expect(dialog()).toHaveFocus();
    await loaded();
    await waitFor(() => expect(area()).toHaveFocus());
  });

  it('lays the picture out so that the square shown is exactly the square that will be made', async () => {
    open();
    await loaded();
    const img = pictureOf();
    // 4000x3000, zoom 1: the square is 3000 px; the picture is 4000/3000 wide, centred (500 px in from the left).
    close(parseFloat(img.style.width), (4000 / 3000) * 100, 3);
    close(parseFloat(img.style.height), 100, 3);
    close(parseFloat(img.style.left), (-500 / 3000) * 100, 3);
    close(parseFloat(img.style.top), 0, 3);
    fireEvent.change(slider(), { target: { value: '2' } });
    const { sx, sy, side } = cropRect(4000, 3000, { zoom: 2 });
    close(parseFloat(pictureOf().style.width), (4000 / side) * 100, 3);
    close(parseFloat(pictureOf().style.left), (-sx / side) * 100, 3);
    close(parseFloat(pictureOf().style.top), (-sy / side) * 100, 3);
  });

  describe('using the photo', () => {
    it('hands over the first result, without asking again, when the picture was not moved', async () => {
      const { prepare, onUse } = open();
      await loaded();
      await userEvent.click(useButton());
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(onUse).toHaveBeenCalledTimes(1);
      expect(onUse.mock.calls[0][0]).toBe(result(1).dataUrl);
    });

    it('asks for the photo with the crop that was chosen, once the picture has been moved', async () => {
      const { prepare, onUse } = open();
      await loaded();
      drag(area(), [100, 100], [130, 100]);
      await userEvent.click(useButton());
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(lastCrop(prepare)).toMatchObject({ y: 0.5, zoom: 1 });
      expect(onUse.mock.calls[0][0]).toBe(result(2).dataUrl);
    });

    it('says it is working, turns everything off, and makes the photo only once however often it is pressed', async () => {
      let release;
      const hold = { promise: new Promise((resolve) => { release = resolve; }) };
      const { prepare, onUse } = open({ preparePhoto: fakePrepare({ hold }) });
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      fireEvent.click(useButton());
      await waitFor(() => expect(useButton()).toHaveAttribute('aria-busy', 'true'));
      expect(useButton()).toHaveTextContent('Preparing…');
      expect(useButton()).toBeDisabled();
      expect(slider()).toBeDisabled();
      fireEvent.click(useButton());
      fireEvent.click(useButton());
      expect(prepare).toHaveBeenCalledTimes(2);
      await act(async () => { release(); await hold.promise; });
      await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    });

    it('does not hand over a photo that arrives after the dialog was cancelled', async () => {
      let release;
      const hold = { promise: new Promise((resolve) => { release = resolve; }) };
      const { onUse, onCancel, view } = open({ preparePhoto: fakePrepare({ hold }) });
      await loaded();
      fireEvent.change(slider(), { target: { value: '3' } });
      fireEvent.click(useButton());
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalled();
      view.unmount();
      await act(async () => { release(); await hold.promise; });
      expect(onUse).not.toHaveBeenCalled();
    });

    it('says plainly what went wrong when making the photo fails, stays open, and lets it be tried again', async () => {
      const { onUse } = open({ preparePhoto: fakePrepare({ failNext: new PreparePhotoError(PHOTO_ERRORS.CANNOT_FIT) }) });
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      await userEvent.click(useButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(PHOTO_MESSAGES[PHOTO_ERRORS.CANNOT_FIT]);
      expect(onUse).not.toHaveBeenCalled();
      expect(useButton()).toBeEnabled();
      expect(dialog()).toBeInTheDocument();
    });

    it('clears the message once the crop is changed, and a retry that works hands the photo over', async () => {
      const prepare = vi.fn()
        .mockResolvedValueOnce(result(1))
        .mockRejectedValueOnce(new PreparePhotoError(PHOTO_ERRORS.ENCODE_FAILED))
        .mockResolvedValueOnce(result(3));
      const { onUse } = open({ preparePhoto: prepare });
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      await userEvent.click(useButton());
      await screen.findByRole('alert');
      fireEvent.change(slider(), { target: { value: '2.5' } });
      expect(screen.queryByRole('alert')).toBeNull();
      await userEvent.click(useButton());
      await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    });

    it('shows a plain message for a failure it does not know, never the failure\'s own words', async () => {
      const prepare = vi.fn().mockResolvedValueOnce(result(1)).mockRejectedValueOnce(new Error('secret /Users/me/Pictures/x.jpg blew up'));
      open({ preparePhoto: prepare });
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      await userEvent.click(useButton());
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(PHOTO_MESSAGES[PHOTO_ERRORS.ENCODE_FAILED]);
      expect(alert.textContent).not.toMatch(/secret|Users|Pictures/);
    });
  });

  describe('moving the picture', () => {
    it('follows a drag: the picture moves with the pointer, and the crop moves the other way', async () => {
      const { prepare } = open();
      await loaded();
      // 30 px to the right, on a 300 px area showing 3000 picture pixels: 300 picture pixels, so the centre goes left by 300/4000.
      drag(area(), [100, 100], [130, 100]);
      await userEvent.click(useButton());
      close(lastCrop(prepare).x, 0.5 - 300 / 4000);
      close(lastCrop(prepare).y, 0.5);
    });

    it('moves up and down the same way once zoomed in', async () => {
      const { prepare } = open();
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      // Zoomed 2x, the area shows 1500 picture pixels: 5 per screen pixel. 15 px down is 75, of 3000.
      drag(area(), [100, 100], [100, 115]);
      await userEvent.click(useButton());
      close(lastCrop(prepare).y, 0.5 - 75 / 3000);
      close(lastCrop(prepare).x, 0.5);
      close(lastCrop(prepare).zoom, 2);
    });

    it('stops at the edge of the picture: dragging as far as you like cannot leave it blank', async () => {
      const { prepare, view } = open();
      await loaded();
      drag(area(), [0, 0], [10_000, 10_000]);
      await userEvent.click(useButton());
      // The square is 3000 of 4000 wide: its centre cannot go below 1500/4000 or above 2500/4000.
      close(lastCrop(prepare).x, 1500 / 4000);
      close(lastCrop(prepare).y, 0.5);
      view.unmount();
      const second = open();
      await loaded();
      drag(area(), [0, 0], [-10_000, 0]);
      await userEvent.click(useButton());
      close(lastCrop(second.prepare).x, 2500 / 4000);
    });

    it('does not creep back from an edge: pulling past it and returning moves from where the picture really is', async () => {
      const { prepare } = open();
      await loaded();
      pointer('pointerDown', area(), { clientX: 0, clientY: 0 });
      pointer('pointerMove', area(), { clientX: 5000, clientY: 0 });
      pointer('pointerMove', area(), { clientX: 15, clientY: 0 });
      pointer('pointerUp', area(), { clientX: 15, clientY: 0 });
      await userEvent.click(useButton());
      // Back to 15 px right of where the drag began: 150 picture pixels left of the centre.
      close(lastCrop(prepare).x, 0.5 - 150 / 4000);
    });

    it('ignores movement when nothing is pressed, and a pointer that is not the main button', async () => {
      const { prepare } = open();
      await loaded();
      pointer('pointerMove', area(), { clientX: 200, clientY: 200 });
      pointer('pointerDown', area(), { clientX: 0, clientY: 0, button: 2 });
      pointer('pointerMove', area(), { clientX: 100, clientY: 0 });
      await userEvent.click(useButton());
      expect(prepare).toHaveBeenCalledTimes(1);
    });

    it('takes the picture\'s own size from what was drawn when the layout cannot be measured', async () => {
      const { prepare } = open();
      await loaded();
      area().getBoundingClientRect = () => ({ width: 0, height: 0 });
      drag(area(), [100, 100], [130, 100]);
      await userEvent.click(useButton());
      // 300 is the fallback, so the same 30 px is the same 300 picture pixels.
      close(lastCrop(prepare).x, 0.5 - 300 / 4000);
    });

    it('does nothing to a picture that has not loaded, or while it is busy', async () => {
      const { prepare } = open();
      drag(area(), [100, 100], [200, 100]);
      await loaded();
      await userEvent.click(useButton());
      expect(prepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('zooming', () => {
    it('follows the slider, and keeps the centre where it was', async () => {
      const { prepare } = open();
      await loaded();
      drag(area(), [100, 100], [130, 100]);
      fireEvent.change(slider(), { target: { value: '2' } });
      expect(slider()).toHaveValue('2');
      expect(slider()).toHaveAttribute('aria-valuetext', '2.0×');
      await userEvent.click(useButton());
      const crop = lastCrop(prepare);
      close(crop.zoom, 2);
      close(crop.x, 0.5 - 300 / 4000);
    });

    it('steps with the buttons, a quarter at a time, and stops at the ends', async () => {
      open();
      await loaded();
      expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
      await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(slider()).toHaveValue('1.25');
      await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
      expect(slider()).toHaveValue('1');
      fireEvent.change(slider(), { target: { value: String(PHOTO.MAX_ZOOM) } });
      expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
      expect(slider()).toHaveValue(String(PHOTO.MAX_ZOOM));
    });

    it('holds zoom between 1 and the most, whatever it is told', async () => {
      const { prepare } = open();
      await loaded();
      fireEvent.change(slider(), { target: { value: '50' } });
      await userEvent.click(useButton());
      close(lastCrop(prepare).zoom, PHOTO.MAX_ZOOM);
    });

    it('zooms with the wheel, in and out, without scrolling the page, and never below 1', async () => {
      open();
      await loaded();
      const notScrolled = fireEvent.wheel(area(), { deltaY: -400 });
      expect(notScrolled).toBe(false);
      expect(Number(slider().value)).toBeGreaterThan(1.5);
      fireEvent.wheel(area(), { deltaY: 20_000 });
      expect(slider()).toHaveValue('1');
      fireEvent.wheel(area(), { deltaY: -20_000 });
      expect(slider()).toHaveValue(String(PHOTO.MAX_ZOOM));
    });

    it('zooms with a two-finger pinch: twice as far apart is twice as close', async () => {
      open();
      await loaded();
      pointer('pointerDown', area(), { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 150 });
      pointer('pointerDown', area(), { pointerType: 'touch', pointerId: 2, clientX: 200, clientY: 150 });
      pointer('pointerMove', area(), { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 150 });
      pointer('pointerMove', area(), { pointerType: 'touch', pointerId: 2, clientX: 250, clientY: 150 });
      close(Number(slider().value), 2, 5);
      pointer('pointerUp', area(), { pointerType: 'touch', pointerId: 2, clientX: 250, clientY: 150 });
      pointer('pointerUp', area(), { pointerType: 'touch', pointerId: 1, clientX: 50, clientY: 150 });
    });

    it('carries on as a drag when one finger is lifted after a pinch', async () => {
      const { prepare } = open();
      await loaded();
      pointer('pointerDown', area(), { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 150 });
      pointer('pointerDown', area(), { pointerType: 'touch', pointerId: 2, clientX: 200, clientY: 150 });
      pointer('pointerMove', area(), { pointerType: 'touch', pointerId: 2, clientX: 300, clientY: 150 });
      pointer('pointerUp', area(), { pointerType: 'touch', pointerId: 2, clientX: 300, clientY: 150 });
      const zoomed = Number(slider().value);
      expect(zoomed).toBeGreaterThan(1);
      pointer('pointerMove', area(), { pointerType: 'touch', pointerId: 1, clientX: 130, clientY: 150 });
      pointer('pointerUp', area(), { pointerType: 'touch', pointerId: 1, clientX: 130, clientY: 150 });
      await userEvent.click(useButton());
      expect(lastCrop(prepare).x).toBeLessThan(0.5);
    });

    it('puts the photo back with the button: centred, zoom 1; and the button is off when it already is', async () => {
      const { prepare } = open();
      await loaded();
      const back = screen.getByRole('button', { name: 'Put the photo back' });
      expect(back).toBeDisabled();
      drag(area(), [100, 100], [130, 100]);
      fireEvent.change(slider(), { target: { value: '3' } });
      expect(back).toBeEnabled();
      await userEvent.click(back);
      expect(slider()).toHaveValue('1');
      expect(back).toBeDisabled();
      await userEvent.click(useButton());
      // Back to the first result: nothing is made again.
      expect(prepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('with a keyboard', () => {
    it('moves the picture with the arrow keys, further with Shift', async () => {
      const user = userEvent.setup();
      const { prepare, view } = open();
      await loaded();
      area().focus();
      await user.keyboard('{ArrowRight}');
      await user.click(useButton());
      // 5% of the 3000 px square, to the right: the centre goes left by 150 of 4000.
      close(lastCrop(prepare).x, 0.5 - 150 / 4000);
      view.unmount();
      const second = open();
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      area().focus();
      await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
      await user.click(useButton());
      // Zoomed 2x the square is 1500 px; 20% of it to the left is 300, so the centre goes right by 300 of 4000.
      close(lastCrop(second.prepare).x, 0.5 + 300 / 4000);
    });

    it('moves up and down too, and does not let the arrow keys scroll the page', async () => {
      const user = userEvent.setup();
      const { prepare } = open();
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      area().focus();
      const prevented = !fireEvent.keyDown(area(), { key: 'ArrowDown' });
      expect(prevented).toBe(true);
      await user.click(useButton());
      // zoom 2: a 1500 px square; 5% of it is 75, of 3000: up.
      close(lastCrop(prepare).y, 0.5 - 75 / 3000);
    });

    it('zooms with + and -, and puts the photo back with 0', async () => {
      const user = userEvent.setup();
      open();
      await loaded();
      area().focus();
      await user.keyboard('+');
      expect(slider()).toHaveValue('1.25');
      await user.keyboard('=');
      expect(slider()).toHaveValue('1.5');
      await user.keyboard('-');
      expect(slider()).toHaveValue('1.25');
      await user.keyboard('0');
      expect(slider()).toHaveValue('1');
    });

    it('is reached by Tab: the picture area, then zoom out, the slider, zoom in, put back, Cancel and Use photo', async () => {
      const user = userEvent.setup();
      open();
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      await waitFor(() => expect(area()).toHaveFocus());
      const order = [];
      for (let i = 0; i < 6; i += 1) {
        await user.tab();
        order.push(document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim());
      }
      expect(order).toEqual(['Zoom out', 'Zoom', 'Zoom in', 'Put the photo back', 'Cancel', 'Use photo']);
    });

    it('keeps Tab inside: from the last control it goes to the first, and Shift+Tab goes the other way', async () => {
      const user = userEvent.setup();
      open();
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      useButton().focus();
      await user.tab();
      expect(area()).toHaveFocus();
      await user.tab({ shift: true });
      expect(useButton()).toHaveFocus();
    });

    it('can be left with Escape, from anywhere inside it', async () => {
      const user = userEvent.setup();
      const { onCancel } = open();
      await loaded();
      area().focus();
      await user.keyboard('{Escape}');
      expect(onCancel).toHaveBeenCalledTimes(1);
      slider().focus();
      await user.keyboard('{Escape}');
      expect(onCancel).toHaveBeenCalledTimes(2);
    });
  });

  describe('leaving', () => {
    it('is Cancel: nothing is made, nothing is handed over', async () => {
      const { onCancel, onUse, prepare } = open();
      await loaded();
      drag(area(), [100, 100], [130, 100]);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onUse).not.toHaveBeenCalled();
      expect(prepare).toHaveBeenCalledTimes(1);
    });

    it('does not close for a click outside it: a stray touch must not throw a crop away', async () => {
      const { onCancel } = open();
      await loaded();
      await userEvent.click(document.querySelector('.mycard-crop-backdrop'));
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('stops the page behind from scrolling while it is open, and gives that back', async () => {
      document.body.style.overflow = 'auto';
      const { view } = open();
      expect(document.body.style.overflow).toBe('hidden');
      view.unmount();
      expect(document.body.style.overflow).toBe('auto');
    });

    it('gives back the temporary address of the picture when it closes, and again for the next one', async () => {
      const { view } = open();
      await loaded();
      expect(revoked).toEqual([]);
      view.unmount();
      expect(revoked).toEqual(['blob:synthetic-1']);
    });
  });

  describe('a picture that cannot be used', () => {
    for (const code of [PHOTO_ERRORS.UNSUPPORTED_FORMAT, PHOTO_ERRORS.DECODE_FAILED, PHOTO_ERRORS.TOO_SMALL, PHOTO_ERRORS.TOO_LARGE_SOURCE, PHOTO_ERRORS.NO_FILE]) {
      it(`says so plainly for "${code}", before any cropping, and offers another or Cancel`, async () => {
        const onChooseAnother = vi.fn();
        const { onUse } = open({ preparePhoto: fakePrepare({ failFirst: new PreparePhotoError(code) }), onChooseAnother });
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(PHOTO_MESSAGES[code]);
        expect(screen.queryByRole('group', { name: 'Photo position' })).toBeNull();
        expect(screen.queryByRole('slider')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Use photo' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Choose another photo' }));
        expect(onChooseAnother).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        expect(onUse).not.toHaveBeenCalled();
      });
    }

    it('does not offer another when it was not given a way to', async () => {
      open({ preparePhoto: fakePrepare({ failFirst: new PreparePhotoError(PHOTO_ERRORS.DECODE_FAILED) }) });
      await screen.findByRole('alert');
      expect(screen.queryByRole('button', { name: 'Choose another photo' })).toBeNull();
    });

    it('says the picture is damaged when the browser cannot show it, even if it could be made', async () => {
      open();
      fireEvent.error(pictureOf());
      expect(await screen.findByRole('alert')).toHaveTextContent(PHOTO_MESSAGES[PHOTO_ERRORS.DECODE_FAILED]);
    });

    it('can be left with Escape too', async () => {
      const { onCancel } = open({ preparePhoto: fakePrepare({ failFirst: new PreparePhotoError(PHOTO_ERRORS.DECODE_FAILED) }) });
      await screen.findByRole('alert');
      dialog().focus();
      await userEvent.keyboard('{Escape}');
      expect(onCancel).toHaveBeenCalled();
    });

    it('keeps Tab inside when there is almost nothing to Tab to', async () => {
      const user = userEvent.setup();
      open({ preparePhoto: fakePrepare({ failFirst: new PreparePhotoError(PHOTO_ERRORS.DECODE_FAILED) }) });
      await screen.findByRole('alert');
      screen.getByRole('button', { name: 'Cancel' }).focus();
      await user.tab();
      expect(dialog().contains(document.activeElement)).toBe(true);
    });
  });

  describe('what it shows', () => {
    it('never contains a picture: not in the dialog, not in a message, not in a label, after using a photo or failing to', async () => {
      const prepare = vi.fn().mockResolvedValueOnce(result(1)).mockRejectedValueOnce(new PreparePhotoError(PHOTO_ERRORS.CANNOT_FIT));
      open({ preparePhoto: prepare });
      await loaded();
      fireEvent.change(slider(), { target: { value: '2' } });
      await userEvent.click(useButton());
      await screen.findByRole('alert');
      const fingerprint = fingerprintOf(result(1).dataUrl);
      expect(textual().some((text) => text.includes(fingerprint) || /base64|data:image/.test(text))).toBe(false);
    });

    it('never shows the file\'s name', async () => {
      open({ file: file('Holiday-with-Dad-2026.jpg') });
      await loaded();
      expect(textual().some((text) => /Holiday|Dad/.test(text))).toBe(false);
    });
  });
});

// ── In the form ────────────────────────────────────────────────────────────────

function Page({ initial = newCard(), preparePhoto = fakePrepare(), disabled = false, onDraft, editing = true }) {
  const draft = useCardDraft(initial);
  onDraft?.(draft);
  return (
    <MyCardLayout
      editing={editing}
      editor={(
        <MyCardEditor
          card={draft.card}
          errors={draft.errors}
          onEdit={draft.edit}
          onBlur={draft.blur}
          onShare={draft.setShare}
          disabled={disabled}
          preparePhoto={preparePhoto}
        />
      )}
      preview={<MyCardPreview card={draft.card} />}
    />
  );
}
const preview = () => screen.getByRole('region', { name: 'What people will see' });
const named = { ...newCard(), firstName: 'Ada', lastName: 'Lovelace' };
const fileInput = () => screen.getByLabelText('Choose a photo from your device');
const previewImage = () => within(preview()).getByRole('article').querySelector('img');
const pick = (f = file()) => userEvent.upload(fileInput(), f, { applyAccept: false });

describe('adding a photo in the form', () => {
  it('opens the crop dialog for the picture chosen, with focus in it, and the form behind it unchanged', async () => {
    let draft;
    render(<Page initial={named} onDraft={(d) => { draft = d; }} />);
    await pick();
    expect(dialog()).toBeInTheDocument();
    expect(draft.card.photoUrl).toBe('');
    expect(draft.dirty).toBe(false);
  });

  it('makes the photo the card\'s, at once, as an unsaved edit that the preview shows', async () => {
    let draft;
    const prepare = fakePrepare();
    render(<Page initial={named} preparePhoto={prepare} onDraft={(d) => { draft = d; }} />);
    expect(previewImage()).toBeNull();
    await pick();
    await loaded();
    await userEvent.click(useButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(draft.card.photoUrl).toBe(result(1).dataUrl);
    expect(draft.dirty).toBe(true);
    expect(previewImage()).toHaveAttribute('src', result(1).dataUrl);
    expect(document.querySelector('.mycard-photo-row img')).toHaveAttribute('src', result(1).dataUrl);
  });

  it('is shown to people only while the Photo switch is on: private, the card keeps it and the preview does not', async () => {
    let draft;
    render(<Page initial={{ ...named, share: { ...newCard().share, photoUrl: false } }} onDraft={(d) => { draft = d; }} />);
    await pick();
    await loaded();
    await userEvent.click(useButton());
    expect(draft.card.photoUrl).toBe(result(1).dataUrl);
    expect(draft.card.share.photoUrl).toBe(false);
    expect(previewImage()).toBeNull();
    expect(within(preview()).getByText(/Kept private:.*Photo/)).toBeInTheDocument();
    expect(document.querySelector('.mycard-photo-row img')).toHaveAttribute('src', result(1).dataUrl);
    await userEvent.click(screen.getByRole('switch', { name: 'Photo on your card' }));
    expect(previewImage()).toHaveAttribute('src', result(1).dataUrl);
  });

  it('leaves the Photo switch exactly as it was', async () => {
    render(<Page initial={named} />);
    const before = screen.getByRole('switch', { name: 'Photo on your card' }).getAttribute('aria-checked');
    await pick();
    await loaded();
    await userEvent.click(useButton());
    expect(screen.getByRole('switch', { name: 'Photo on your card' })).toHaveAttribute('aria-checked', before);
  });

  it('puts focus back on Upload photo, and says for a screen reader that the photo is added and not saved', async () => {
    render(<Page initial={named} />);
    await pick();
    await loaded();
    await userEvent.click(useButton());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload photo' })).toHaveFocus());
    expect(screen.getByText('Photo added. It is not saved until you press Save.')).toBeInTheDocument();
  });

  it('replaces a photo that is there with no questions asked: a new one is the answer', async () => {
    let draft;
    render(<Page initial={{ ...named, photoUrl: 'https://images.example.com/ada.jpg' }} onDraft={(d) => { draft = d; }} />);
    await pick();
    await loaded();
    await userEvent.click(useButton());
    expect(draft.card.photoUrl).toBe(result(1).dataUrl);
    expect(screen.queryByRole('group', { name: /Remove your photo/ })).toBeNull();
    // And then another, over that.
    await pick();
    await loaded();
    fireEvent.change(slider(), { target: { value: '2' } });
    await userEvent.click(useButton());
    expect(draft.card.photoUrl).toBe(result(2).dataUrl);
  });

  it('leaves everything as it was when the dialog is cancelled, and puts focus back on Upload photo', async () => {
    let draft;
    render(<Page initial={{ ...named, photoUrl: 'https://images.example.com/ada.jpg' }} onDraft={(d) => { draft = d; }} />);
    await pick();
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(draft.card.photoUrl).toBe('https://images.example.com/ada.jpg');
    expect(draft.dirty).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload photo' })).toHaveFocus());
  });

  it('is left with Escape the same way', async () => {
    render(<Page initial={named} />);
    await pick();
    await loaded();
    area().focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload photo' })).toHaveFocus());
  });

  it('lets the same file be chosen again straight after: the choice is cleared each time', async () => {
    render(<Page initial={named} />);
    const same = file('same.jpg');
    await pick(same);
    await loaded();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fileInput().value).toBe('');
    await pick(same);
    expect(dialog()).toBeInTheDocument();
  });

  it('opens nothing when the file chooser was closed with no file', async () => {
    render(<Page initial={named} />);
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the plain reason inside the dialog for a file that cannot be used, and offers another which opens the chooser', async () => {
    const prepare = fakePrepare({ failFirst: new PreparePhotoError(PHOTO_ERRORS.UNSUPPORTED_FORMAT) });
    render(<Page initial={named} preparePhoto={prepare} />);
    await pick(file('photo.heic', 'image/heic'));
    expect(await screen.findByRole('alert')).toHaveTextContent(PHOTO_MESSAGES[PHOTO_ERRORS.UNSUPPORTED_FORMAT]);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Choose another photo' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('cannot be opened when the form is read-only', async () => {
    render(<Page initial={named} disabled />);
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeDisabled();
    expect(fileInput()).toBeDisabled();
  });

  it('keeps an uploaded photo out of every box, label and message in the form', async () => {
    const { container } = render(<Page initial={named} />);
    await pick();
    await loaded();
    await userEvent.click(useButton());
    const fingerprint = fingerprintOf(result(1).dataUrl);
    expect(textual().some((text) => text.includes(fingerprint) || /data:image\/jpeg;base64/.test(text))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByLabelText('Photo link')).toHaveValue('');
    expect(container.innerHTML.includes(fingerprint)).toBe(true);   // as the picture's own source, and only there
    expect([...document.querySelectorAll('[src*="' + fingerprint + '"]')].every((node) => node.tagName === 'IMG')).toBe(true);
  });

  it('sends nothing anywhere: no network call is made to add, crop or use a photo', async () => {
    const fetchSpy = vi.fn();
    const beacon = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const originalBeacon = navigator.sendBeacon;
    navigator.sendBeacon = beacon;
    const open = vi.spyOn(XMLHttpRequest.prototype, 'open');
    try {
      render(<Page initial={named} />);
      await pick();
      await loaded();
      drag(area(), [100, 100], [140, 100]);
      await userEvent.click(useButton());
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beacon).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    } finally {
      navigator.sendBeacon = originalBeacon;
      vi.unstubAllGlobals();
    }
  });
});

describe('the dialog and the page around it', () => {
  it('is drawn on the page itself, not inside the form, so nothing can clip or scroll it', async () => {
    const { container } = render(<Page initial={named} />);
    await pick();
    expect(container.querySelector('.mycard-crop-backdrop')).toBeNull();
    expect(document.body.querySelector(':scope > .mycard-crop-backdrop')).not.toBeNull();
  });

  it('is gone from the page when the form goes', async () => {
    const { unmount } = render(<Page initial={named} />);
    await pick();
    expect(document.querySelector('.mycard-crop-backdrop')).not.toBeNull();
    unmount();
    expect(document.querySelector('.mycard-crop-backdrop')).toBeNull();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('keeps its own state when the form around it redraws', async () => {
    function Wrapper() {
      const [count, setCount] = useState(0);
      return (<><button type="button" onClick={() => setCount(count + 1)}>redraw {count}</button><Page initial={named} /></>);
    }
    render(<Wrapper />);
    await pick();
    await loaded();
    fireEvent.change(slider(), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: /redraw/ }));
    expect(slider()).toHaveValue('2');
  });
});
