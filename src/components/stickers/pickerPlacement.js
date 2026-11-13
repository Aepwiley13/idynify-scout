/**
 * True when a popover rendered below its anchor would not fit in the visible
 * area and there is more room above. The visible area is the viewport
 * narrowed by every ancestor that clips (scroll containers, overflow hidden),
 * so nested scroll regions such as the contact panel are accounted for.
 */
export function shouldOpenAbove(popover, gap = 8) {
  const anchor = popover.parentElement;
  if (!anchor || typeof window === 'undefined') return false;
  const height = popover.getBoundingClientRect().height;
  if (!height) return false;
  let top = 0;
  let bottom = window.innerHeight;
  for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
    if (!/^(auto|scroll|hidden|clip)$/.test(window.getComputedStyle(el).overflowY)) continue;
    const rect = el.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  const box = anchor.getBoundingClientRect();
  const below = bottom - box.bottom;
  const room = top < box.top ? box.top - top : 0;
  return below < height + gap && room > below;
}
