// A write that takes a moment, and can be made to fail. It records what was asked, so the capture can read it.
const params = new URLSearchParams(window.location.search);
const latency = Number(params.get('latency') ?? 600);
const failing = params.get('fail') === '1';
window.__writes = [];
export const doc = (_db, ...segments) => ({ path: segments.join('/') });
export const updateDoc = (ref, data) => new Promise((resolve, reject) => {
  window.__writes.push({ path: ref.path, data });
  setTimeout(() => {
    if (failing) { const error = new Error('fixture failure'); error.code = 'unavailable'; reject(error); } else resolve();
  }, latency);
});
