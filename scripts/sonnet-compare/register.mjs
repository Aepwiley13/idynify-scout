/** Registers the capture loader. Imported first by compare.mjs; nothing else uses it. */
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
