// The sticker registry, in memory.
const REGISTRY = [
  ['Board member', 'blue', null], ['Community', 'green', '🌱'], ['Donor', 'amber', null], ['Education', 'teal', null], ['Gala 2026', 'pink', '🎟️'],
  ['Mentor', 'purple', '🧭'], ['Partner', 'purple', '🤝'], ['Priority', 'coral', '⭐'], ['Supporter', 'pink', '💜'], ['Volunteer', 'teal', '🙌'],
].map(([name, color, emoji], i) => ({ id: `S${String(i).padStart(2, '0')}`, name, color, emoji, status: 'active' }));
let current = REGISTRY;
const listeners = new Set();
export function subscribeStickers(_uid, onNext) {
  listeners.add(onNext);
  Promise.resolve().then(() => onNext(current));
  return () => listeners.delete(onNext);
}
export async function createSticker(_uid, { name, color = 'gray' }) {
  const id = `N${Date.now()}`;
  current = [...current, { id, name, color, emoji: null, status: 'active' }];
  for (const l of listeners) l(current);
  return { id };
}
