/**
 * AN INERT ILLUSTRATION of the proposed "+ Add sticker" chip, for design review only.
 *
 * PersonHeader (the production component) has no such control and gains none from this file.
 * This adds, to the synthetic fixture page only, after the header has drawn, a decorative chip
 * that is clearly marked (data-inert-mock), hidden from assistive technology (aria-hidden),
 * not focusable and not clickable (inert, pointer-events: none). It is a list item holding a
 * span, never a button. It is used only when the page is opened with ?mock=add-sticker.
 *
 * The approved design: a "+ Add sticker" chip with a soft lavender dashed outline and purple text,
 * about 36px high like the sticker pills, with a touch area of at least 44px (the ::after ring
 * marks it), as the last item of the sticker flow, with a 10px row gap so touch areas never overlap.
 * The 10px gap is applied here, to the fixture only; the component's own gap is unchanged.
 */
const CSS = `
.ph-stickers[data-inert-mock-flow] { row-gap: 10px; }
.ph-add-mock {
  display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; position: relative;
  min-height: 36px; padding: 0 14px 0 10px; border-radius: 999px;
  border: 1.5px dashed color-mix(in srgb, var(--ph-ink) 70%, transparent);
  background: transparent; color: var(--ph-ink);
  font-size: 14px; font-weight: 600; line-height: 1.25; pointer-events: none; user-select: none;
}
/* The touch area: at least 44px high (4px above and below the 36px chip). Drawn only so the review can see it. */
.ph-add-mock::after {
  content: ""; position: absolute; inset: -4px 0; border-radius: 999px;
  outline: 1px dotted color-mix(in srgb, var(--ph-ink) 35%, transparent);
}
`;
const PLUS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

export function addInertAddStickerMock(root = document) {
  if (!document.getElementById('ph-add-mock-css')) {
    const style = document.createElement('style');
    style.id = 'ph-add-mock-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  for (const scene of root.querySelectorAll('[data-scene]')) {
    // Only where stickers are available (and, in the product, writable): never where they are not.
    if (scene.dataset.stickers !== 'available') continue;
    const card = scene.querySelector('.ph-card');
    let list = card.querySelector('.ph-stickers');
    if (!list) {
      // Available but none assigned: the sticker area is the control by itself.
      list = document.createElement('ul');
      list.className = 'ph-stickers';
      card.appendChild(list);
      card.dataset.layout = card.dataset.layout.replace(/s0$/, 's1');
    }
    list.setAttribute('data-inert-mock-flow', '');
    const item = document.createElement('li');
    item.className = 'ph-add-mock';
    item.setAttribute('data-inert-mock', 'add-sticker');
    item.setAttribute('aria-hidden', 'true');
    item.setAttribute('inert', '');
    item.innerHTML = `${PLUS}<span>Add sticker</span>`;
    list.appendChild(item);
  }
}

export default addInertAddStickerMock;
