/**
 * The page's sticker state, as the StickersProvider shares it. Kept apart
 * from the provider component so that file exports components only.
 */
import { createContext, useContext } from 'react';
import { AVAILABILITY } from './stickersAvailabilityState.js';

export const REGISTRY_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });

export const NO_STICKERS = Object.freeze({
  provided: false,
  availability: AVAILABILITY.UNAVAILABLE,
  recheck: () => {},
  uid: null,
  status: REGISTRY_STATUS.IDLE,
  all: [],
  active: [],
  archived: [],
  byId: new Map(),
});

export const StickersContext = createContext(NO_STICKERS);

/**
 * The page's sticker state. `ready` is true only when sticker surfaces may
 * show: the server said available, and the registry has loaded. Outside any
 * provider it is false, so a surface mounted without one shows nothing.
 */
export function useStickers() {
  const value = useContext(StickersContext);
  return { ...value, ready: value.availability === AVAILABILITY.AVAILABLE && value.status === REGISTRY_STATUS.READY };
}
