/** Registers the JSX/CSS loader. Used only by phase5-verification.mjs. */
import { register } from 'node:module';
register('./phase5-loader.mjs', import.meta.url);
