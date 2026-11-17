/**
 * The real My Card page, for looking at, with the card service, Firebase auth
 * and impersonation replaced by stand-ins (vite.config.mjs) and sample data.
 *
 *   ?theme=workspace|mission
 *   ?state=existing|new|loaderror|restored|olddraft|saveerror|saveconflict|impersonating
 *   ?do=step,step,...   what a person would do once the page is up, one step at a time:
 *        edit:<Label>=<text>   click:<button text>   toggle:<Field>
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
  }
  await wait(250);
}

async function script() {
  // The page is up when it has its form, an error, or a notice.
  for (let i = 0; i < 80 && !document.querySelector('.mycard form, .mycard [role="alert"], .mycard [role="status"]'); i += 1) await wait(100);
  await wait(300);
  for (const step of (params.get('do') ?? '').split(',').filter(Boolean)) {
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
