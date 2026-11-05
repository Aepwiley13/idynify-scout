/** What the sticker picker lists, for a search (UI spec §1.2). */
import { stickerNameKey, STICKER_NAME_MAX } from '../../services/stickers/stickerCore';

/**
 * The options, in order: Recent (that match), then All stickers (that match),
 * then — when the search names no sticker — Create, or, when it names one,
 * "already exists — use it". Pure, so it is tested on its own.
 */
export function buildPickerOptions({ stickers, assignedIds = new Set(), recentIds = [], query = '', atLimit = false, allowCreate = true }) {
  const q = query.trim().replace(/\s+/g, ' ');
  const needle = q.toLowerCase();
  const matches = stickers.filter((s) => !needle || s.name.toLowerCase().includes(needle));
  const matchIds = new Set(matches.map((s) => s.id));
  const byId = new Map(stickers.map((s) => [s.id, s]));
  const recent = recentIds.map((id) => byId.get(id)).filter((s) => s && matchIds.has(s.id));
  const recentIds_ = new Set(recent.map((s) => s.id));
  const option = (sticker, group) => {
    const assigned = assignedIds.has(sticker.id);
    return { kind: 'sticker', group, key: `${group}-${sticker.id}`, sticker, assigned, disabled: assigned || atLimit };
  };
  const out = [
    ...recent.map((s) => option(s, 'recent')),
    ...matches.filter((s) => !recentIds_.has(s.id)).map((s) => option(s, 'all')),
  ];
  if (q) {
    const same = stickers.find((s) => stickerNameKey(s.name) === stickerNameKey(q));
    if (same) {
      if (!assignedIds.has(same.id)) out.push({ kind: 'existing', group: 'create', key: `existing-${same.id}`, sticker: same, assigned: false, disabled: atLimit });
    } else if (allowCreate) {
      out.push({ kind: 'create', group: 'create', key: 'create', name: q, assigned: false, disabled: atLimit || q.length > STICKER_NAME_MAX });
    }
  }
  return out;
}
