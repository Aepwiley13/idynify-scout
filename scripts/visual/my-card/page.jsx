/**
 * The real My Card page, for looking at, with the card service, Firebase auth
 * and impersonation replaced by stand-ins (vite.config.mjs) and sample data.
 *
 *   ?theme=workspace|mission
 *   ?state=existing|new|loaderror|restored|olddraft|saveerror|saveconflict|impersonating
 *   ?do=step|step|...   what a person would do once the page is up, one step at a time:
 *        edit:<Label>=<text>   click:<button text>   toggle:<Field>
 *        upload:photo|broken   choose a SYNTHETIC picture (never a real photograph) as the file
 *        zoom:<n>   drag:<dx>/<dy>   the crop dialog's slider, and a drag of its picture (screen pixels)
 *
 * Nothing here reads or writes any database.
 */
import '../../../src/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import MyCardPage from '../../../src/pages/ContactHub/MyCardPage';

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get('theme') === 'mission' ? 'mission' : 'workspace';

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const labelled = (text) => {
  const label = [...document.querySelectorAll('label')].find((node) => node.textContent.trim() === text);
  return label ? document.getElementById(label.htmlFor) : null;
};
const buttonNamed = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text && !node.disabled)
  ?? [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text);

function setValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A made-up picture to crop: sky, sun, a plain head and shoulders and a grid, so moving and zooming show. Nobody's photo. */
async function syntheticFile(kind) {
  if (kind === 'broken') return new File([new TextEncoder().encode('this is not a picture '.repeat(40))], 'broken.jpg', { type: 'image/jpeg' });
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 1200;
  const x = canvas.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 1600, 1200);
  sky.addColorStop(0, '#2c6e9b'); sky.addColorStop(1, '#c1578a');
  x.fillStyle = sky; x.fillRect(0, 0, 1600, 1200);
  x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 2;
  for (let i = 0; i <= 1600; i += 100) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1200); x.stroke(); }
  for (let i = 0; i <= 1200; i += 100) { x.beginPath(); x.moveTo(0, i); x.lineTo(1600, i); x.stroke(); }
  x.fillStyle = '#f7d774'; x.beginPath(); x.arc(1350, 220, 110, 0, 7); x.fill();
  x.fillStyle = '#2b2146'; x.beginPath(); x.ellipse(760, 1180, 520, 360, 0, 0, 7); x.fill();
  x.fillStyle = '#f0cdb4'; x.beginPath(); x.ellipse(760, 560, 230, 290, 0, 0, 7); x.fill();
  x.fillStyle = '#3a2a24'; x.beginPath(); x.ellipse(760, 380, 250, 170, 0, Math.PI, 0); x.fill();
  const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', 0.9); });
  return new File([blob], 'synthetic.jpg', { type: 'image/jpeg' });
}

/** Hands a file to the page's own file input, the way choosing one in the picker does. */
function chooseFile(file) {
  const input = document.querySelector('input[type="file"][aria-label="Choose a photo from your device"]');
  if (!input) throw new Error('no file input');
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The dialog is ready to use, or has said why not. */
async function dialogSettled() {
  for (let i = 0; i < 80; i += 1) {
    const dialog = document.querySelector('.mycard-crop');
    const use = dialog && [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Use photo');
    if ((use && !use.disabled) || dialog?.querySelector('[role="alert"]')) return;
    await wait(100);
  }
}

function setSlider(value) {
  const slider = document.querySelector('.mycard-crop-slider');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(value));
  slider.dispatchEvent(new Event('input', { bubbles: true }));
}

function dragPicture(dx, dy) {
  const area = document.querySelector('.mycard-crop-viewport');
  const box = area.getBoundingClientRect();
  const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const fire = (type, point) => area.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: point.x, clientY: point.y }));
  fire('pointerdown', from);
  fire('pointermove', { x: from.x + dx, y: from.y + dy });
  fire('pointerup', { x: from.x + dx, y: from.y + dy });
}

async function perform(step) {
  const [kind, ...rest] = step.split(':');
  const argument = rest.join(':');
  if (kind === 'edit') {
    const [label, ...value] = argument.split('=');
    const input = labelled(label);
    if (!input) throw new Error(`no field ${label}`);
    input.focus();
    setValue(input, value.join('='));
    input.blur();
  } else if (kind === 'click') {
    const button = buttonNamed(argument);
    if (!button) throw new Error(`no button ${argument}`);
    button.click();
  } else if (kind === 'toggle') {
    document.querySelector(`[role="switch"][aria-label="${argument} on your card"]`).click();
  } else if (kind === 'upload') {
    chooseFile(await syntheticFile(argument));
    await dialogSettled();
  } else if (kind === 'zoom') {
    setSlider(argument);
  } else if (kind === 'drag') {
    const [dx, dy] = argument.split('/').map(Number);
    dragPicture(dx, dy);
  }
  await wait(250);
}

async function script() {
  // The page is up when it has its form, an error, or a notice.
  for (let i = 0; i < 80 && !document.querySelector('.mycard form, .mycard [role="alert"], .mycard [role="status"]'); i += 1) await wait(100);
  await wait(300);
  for (const step of (params.get('do') ?? '').split('|').filter(Boolean)) {
    try { await perform(step); } catch (error) { document.documentElement.dataset.scriptError = String(error.message); }
  }
  await wait(300);
  document.documentElement.dataset.ready = '1';
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="fx-content">
      <MemoryRouter initialEntries={['/contact-hub/my-card']}>
        <MyCardPage />
      </MemoryRouter>
    </div>
  </StrictMode>,
);
script();
