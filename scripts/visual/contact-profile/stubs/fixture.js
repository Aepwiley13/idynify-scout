// The page's live switches and the write log, shared by the stand-ins. Read at the moment of each write, so the
// controls on the page take effect at once. Nothing here leaves the page.
const params = new URLSearchParams(window.location.search);
if (!window.__fixture) {
  window.__fixture = {
    latency: Number(params.get('latency') ?? 700),
    failNext: false,          // the next contact save fails once
    failNextSticker: false,   // the next sticker change fails once
    readonly: params.get('readonly') === '1',
    stickers: params.get('stickers') ?? 'on', // on | off | readonly
  };
  window.__writes = [];
}
export const fixture = window.__fixture;
export const wait = () => new Promise((resolve) => { setTimeout(resolve, fixture.latency); });
export const log = (entry) => { window.__writes.push({ at: Date.now(), ...entry }); };
