import { fixture, wait, log } from './fixture.js';
const write = (name) => async (uid, contactId, stickerId) => {
  log({ kind: 'sticker', path: `users/${uid}/contacts/${contactId}`, fields: `${name} ${stickerId}` });
  await wait();
  if (fixture.failNextSticker) {
    fixture.failNextSticker = false;
    const error = new Error('fixture failure');
    error.code = 'write_failed';
    throw error;
  }
  return { status: name === 'addSticker' ? 'added' : 'removed' };
};
export const addSticker = write('addSticker');
export const removeSticker = write('removeSticker');
