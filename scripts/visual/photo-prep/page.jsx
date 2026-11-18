/**
 * Profile photo processing, checked in a REAL browser: the real photoPrep.js
 * (and the real canvas, decoder and JPEG encoder) on SYNTHETIC pictures made
 * here: coloured quadrants and gradients, with hand-built EXIF (orientation,
 * a GPS block and marker text), XMP, comments and transparency. No real
 * photograph, no network, no storage. Results are left on
 * window.__photoResults for scripts/visual/photo-prep/check.mjs to read.
 */
import { prepareProfilePhoto, inspectPhotoDataUrl, PHOTO, PHOTO_ERRORS } from '../../../src/utils/photoPrep.js';
import { decodeBase64, hasJpegMetadata, readJpegHeader } from '../../../src/capture/preparedImage.js';

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: Boolean(pass), detail: String(detail) });

// ─── Synthetic pictures ──────────────────────────────────────────────────────

const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const toBlob = (canvas, type, quality) => new Promise((resolve) => { canvas.toBlob(resolve, type, quality); });
const bytesOfBlob = async (blob) => new Uint8Array(await blob.arrayBuffer());
const COLOURS = { R: '#ff0000', G: '#00ff00', B: '#0000ff', Y: '#ffff00' };

/** Four coloured quadrants: red top-left, green top-right, blue bottom-left, yellow bottom-right. */
function quadrants(w, h) {
  const c = canvasOf(w, h);
  const x = c.getContext('2d');
  [['R', 0, 0], ['G', w / 2, 0], ['B', 0, h / 2], ['Y', w / 2, h / 2]].forEach(([k, px, py]) => { x.fillStyle = COLOURS[k]; x.fillRect(px, py, w / 2, h / 2); });
  return c;
}

/** Detailed pictures, to make the encoder work: strokes, or per-pixel noise (the largest a JPEG can be). */
function textured(w, h, kind) {
  const c = canvasOf(w, h);
  const x = c.getContext('2d');
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  if (kind === 'noise') {
    const im = x.createImageData(w, h);
    for (let i = 0; i < im.data.length; i += 4) { im.data[i] = rnd() * 255; im.data[i + 1] = rnd() * 255; im.data[i + 2] = rnd() * 255; im.data[i + 3] = 255; }
    x.putImageData(im, 0, 0);
    return c;
  }
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#6a7fa8'); g.addColorStop(1, '#c98a6b');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 60000; i += 1) {
    x.strokeStyle = `hsla(${Math.floor(rnd() * 360)},40%,${Math.floor(20 + rnd() * 60)}%,0.5)`;
    x.lineWidth = 2 + rnd() * 6; x.beginPath();
    const a = rnd() * w; const b = rnd() * h; x.moveTo(a, b); x.lineTo(a + rnd() * 60 - 30, b + rnd() * 60 - 30); x.stroke();
  }
  return c;
}

const ascii = (text) => [...text].map((ch) => ch.charCodeAt(0) & 0xFF);
const segment = (marker, payload) => [0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF, ...payload];
const u16 = (n) => [n & 0xFF, n >> 8];
const u32 = (n) => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF];

const MARKERS = { exif: 'PRIVATE-DESCRIPTION-91827', xmp: 'PRIVATE-XMP-55512', comment: 'PRIVATE-COMMENT-30417' };

/** A little-endian EXIF block: ImageDescription (with marker text), Orientation, and a GPS IFD. */
function exifBlock(orientation) {
  const description = [...ascii(MARKERS.exif), 0];
  const ifd0Size = 2 + 3 * 12 + 4;
  const dataStart = 8 + ifd0Size;
  const gpsOffset = dataStart + description.length + (description.length % 2);
  const entry = (tag, type, count, value) => [...u16(tag), ...u16(type), ...u32(count), ...value];
  const tiff = [
    ...ascii('II'), ...u16(42), ...u32(8),
    ...u16(3),
    ...entry(0x010E, 2, description.length, u32(dataStart)),
    ...entry(0x0112, 3, 1, [...u16(orientation), 0, 0]),
    ...entry(0x8825, 4, 1, u32(gpsOffset)),
    ...u32(0),
    ...description, ...(description.length % 2 ? [0] : []),
    // GPS IFD: GPSLatitudeRef = "N"
    ...u16(1), ...entry(0x0001, 2, 2, [...ascii('N'), 0, 0, 0]), ...u32(0),
  ];
  return segment(0xE1, [...ascii('Exif'), 0, 0, ...tiff]);
}

/** The same JPEG with an EXIF block (orientation + GPS), XMP and a comment added after SOI. */
function withMetadata(jpeg, orientation) {
  const extra = [
    ...exifBlock(orientation),
    ...segment(0xE1, ascii(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${MARKERS.xmp}</x:xmpmeta>`)),
    ...segment(0xFE, ascii(MARKERS.comment)),
  ];
  const out = new Uint8Array(jpeg.length + extra.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(extra, 2);
  out.set(jpeg.subarray(2), 2 + extra.length);
  return out;
}

const fileOf = (bytes, name, type) => new File([bytes], name, { type });

// ─── Looking at the result ───────────────────────────────────────────────────

async function pixelsOf(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = canvasOf(img.naturalWidth, img.naturalHeight);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  return { width: img.naturalWidth, height: img.naturalHeight, at: (fx, fy) => Array.from(x.getImageData(Math.floor(fx * (img.naturalWidth - 1)), Math.floor(fy * (img.naturalHeight - 1)), 1, 1).data) };
}

function classify([r, g, b]) {
  if (r > 150 && g < 110 && b < 110) return 'R';
  if (g > 150 && r < 110 && b < 110) return 'G';
  if (b > 150 && r < 110 && g < 110) return 'B';
  if (r > 150 && g > 150 && b < 110) return 'Y';
  if (r > 200 && g > 200 && b > 200) return 'W';
  return `?(${r},${g},${b})`;
}
/** The colours near the four corners of the output: TL TR BL BR. */
async function corners(dataUrl) {
  const p = await pixelsOf(dataUrl);
  return ['TL', 'TR', 'BL', 'BR'].map((corner) => classify(p.at(corner.includes('L') ? 0.15 : 0.85, corner.includes('T') ? 0.15 : 0.85))).join('');
}
const bytesOfUrl = (dataUrl) => decodeBase64(dataUrl.slice(PHOTO.DATA_URL_PREFIX.length));
const latin1 = (bytes) => new TextDecoder('latin1').decode(bytes);
const failureCode = async (promise) => { try { await promise; return 'no-error'; } catch (error) { return error.code ?? `unexpected:${error.message}`; } };

// ─── The checks ──────────────────────────────────────────────────────────────

async function run() {
  // 1. Orientation: a 400x300 picture stored with each of the eight EXIF orientations.
  // The expected corners are what a person sees after the orientation is applied.
  const expectedCorners = { 1: 'RGBY', 2: 'GRYB', 3: 'YBGR', 4: 'BYRG', 5: 'RBGY', 6: 'BRYG', 7: 'YGBR', 8: 'GYRB' };
  const upright = await bytesOfBlob(await toBlob(quadrants(400, 300), 'image/jpeg', 0.95));
  for (const [orientation, want] of Object.entries(expectedCorners)) {
    const photo = await prepareProfilePhoto(fileOf(withMetadata(upright, Number(orientation)), `o${orientation}.jpg`, 'image/jpeg'));
    const got = await corners(photo.dataUrl);
    check(`orientation ${orientation} is applied (corners TL TR BL BR)`, got === want, `${got}, wanted ${want}`);
  }

  // 2. Metadata: EXIF with GPS, XMP and a comment never reach the result.
  const tagged = await prepareProfilePhoto(fileOf(withMetadata(upright, 6), 'gps.jpg', 'image/jpeg'));
  const taggedBytes = bytesOfUrl(tagged.dataUrl);
  const text = latin1(taggedBytes);
  check('the input really did carry EXIF, GPS, XMP and a comment', latin1(withMetadata(upright, 6)).includes(MARKERS.exif) && latin1(withMetadata(upright, 6)).includes(MARKERS.xmp), 'markers present in the input');
  for (const [what, needle] of [['EXIF header', 'Exif'], ['EXIF description', MARKERS.exif], ['XMP', MARKERS.xmp], ['XMP namespace', 'ns.adobe.com'], ['comment', MARKERS.comment]]) {
    check(`the result has no ${what}`, !text.includes(needle), needle);
  }
  check('the result has no metadata segment at all', !hasJpegMetadata(taggedBytes), '');
  check('the result passes its own inspection', inspectPhotoDataUrl(tagged.dataUrl).ok, JSON.stringify(inspectPhotoDataUrl(tagged.dataUrl)));

  // 3. Formats.
  for (const [type, ext] of [['image/png', 'png'], ['image/webp', 'webp'], ['image/jpeg', 'jpg']]) {
    const blob = await toBlob(quadrants(500, 500), type, 0.95);
    if (blob.type !== type) { check(`${type} can be made here`, false, `the browser gave ${blob.type}`); continue; }
    const photo = await prepareProfilePhoto(fileOf(await bytesOfBlob(blob), `q.${ext}`, type));
    check(`${type} is processed, upright`, (await corners(photo.dataUrl)) === 'RGBY', `${photo.widthPx}x${photo.heightPx}`);
  }

  // 4. Output spec for ordinary and unusual shapes.
  const shapes = [
    ['4000x3000 detailed', textured(4000, 3000, 'strokes'), 320],
    ['3000x4000 portrait', textured(3000, 4000, 'strokes'), 320],
    ['6000x100 panorama', quadrants(6000, 100), 100],
    ['100x6000 tall strip', quadrants(100, 6000), 100],
    ['200x150 small', quadrants(200, 150), 150],
    ['64x64 smallest allowed', quadrants(64, 64), 64],
    ['5000x5000 square', quadrants(5000, 5000), 320],
  ];
  for (const [name, canvas, wantEdge] of shapes) {
    const started = performance.now();
    const photo = await prepareProfilePhoto(fileOf(await bytesOfBlob(await toBlob(canvas, 'image/jpeg', 0.9)), `${name}.jpg`, 'image/jpeg'));
    const ms = Math.round(performance.now() - started);
    const header = readJpegHeader(bytesOfUrl(photo.dataUrl));
    check(`${name}: ${wantEdge} px square JPEG, real dimensions match, within the cap`,
      photo.mimeType === 'image/jpeg' && header.width === wantEdge && header.height === wantEdge && photo.widthPx === wantEdge && photo.chars <= PHOTO.MAX_DATA_URL_CHARS && photo.dataUrl.startsWith('data:image/jpeg;base64,'),
      `${header.width}x${header.height}, ${photo.chars} chars, ${photo.bytes} bytes, ${photo.attempts} attempt(s), ${ms} ms`);
  }

  // 5. The worst case for size: per-pixel noise AT the output size, which no JPEG compresses
  // and which shrinking cannot average away. (Noise on a big picture becomes smooth grey when it is
  // reduced, so it is not a worst case; noise already at 320 px is.)
  const noisePng = async (edge) => fileOf(await bytesOfBlob(await toBlob(textured(edge, edge, 'noise'), 'image/png')), `noise${edge}.png`, 'image/png');
  for (const edge of [320, 400, 640]) {
    const started = performance.now();
    const photo = await prepareProfilePhoto(await noisePng(edge));
    check(`worst case: ${edge} px per-pixel noise ends within the cap`, photo.chars <= PHOTO.MAX_DATA_URL_CHARS && inspectPhotoDataUrl(photo.dataUrl).ok,
      `${photo.widthPx} px, ${photo.chars} chars, ${photo.attempts} attempt(s), ${Math.round(performance.now() - started)} ms`);
  }
  const first = await prepareProfilePhoto(await noisePng(320));
  check('worst case: it had to compress harder than a normal photo does (more than one attempt, or a high character count)', first.attempts > 1 || first.chars > 50_000, `${first.attempts} attempt(s), ${first.chars} chars`);
  const noiseTight = await failureCode(prepareProfilePhoto(await noisePng(320), { maxChars: 2000 }));
  check('and says so, plainly, when a tighter cap cannot be met', noiseTight === PHOTO_ERRORS.CANNOT_FIT, noiseTight);
  const noiseSmaller = await prepareProfilePhoto(await noisePng(320), { maxChars: 30_000 });
  check('a cap that quality alone cannot meet is met by a smaller picture', noiseSmaller.chars <= 30_000 && noiseSmaller.widthPx < 320, `${noiseSmaller.widthPx} px, ${noiseSmaller.chars} chars, ${noiseSmaller.attempts} attempt(s)`);

  // 6. Cropping: a picture red on the left and blue on the right.
  const halves = canvasOf(1000, 1000);
  const hx = halves.getContext('2d');
  hx.fillStyle = COLOURS.R; hx.fillRect(0, 0, 500, 1000); hx.fillStyle = COLOURS.B; hx.fillRect(500, 0, 500, 1000);
  const halvesFile = fileOf(await bytesOfBlob(await toBlob(halves, 'image/png')), 'h.png', 'image/png');
  const read = async (crop) => { const p = await prepareProfilePhoto(halvesFile, { crop }); return corners(p.dataUrl); };
  check('crop: whole picture, centred, shows both halves', (await read(undefined)) === 'RBRB', await read(undefined));
  check('crop: zoom 2 at x=25% is all red', (await read({ x: 0.25, y: 0.5, zoom: 2 })) === 'RRRR', await read({ x: 0.25, y: 0.5, zoom: 2 }));
  check('crop: zoom 2 at x=75% is all blue', (await read({ x: 0.75, y: 0.5, zoom: 2 })) === 'BBBB', await read({ x: 0.75, y: 0.5, zoom: 2 }));
  check('crop: a centre past the edge is moved inside, not left blank', (await read({ x: -4, y: 9, zoom: 2 })) === 'RRRR', await read({ x: -4, y: 9, zoom: 2 }));
  const wide = await bytesOfBlob(await toBlob(quadrants(1600, 400), 'image/png'));
  const leftEnd = await prepareProfilePhoto(fileOf(wide, 'w.png', 'image/png'), { crop: { x: 0, y: 0.5, zoom: 1 } });
  const rightEnd = await prepareProfilePhoto(fileOf(wide, 'w.png', 'image/png'), { crop: { x: 1, y: 0.5, zoom: 1 } });
  check('crop: on a wide picture the square can be slid to either end', (await corners(leftEnd.dataUrl)) === 'RRBB' && (await corners(rightEnd.dataUrl)) === 'GGYY', `${await corners(leftEnd.dataUrl)} / ${await corners(rightEnd.dataUrl)}`);

  // 7. Transparency is white, not black.
  const clear = canvasOf(400, 400);
  const clearFile = fileOf(await bytesOfBlob(await toBlob(clear, 'image/png')), 'clear.png', 'image/png');
  check('a fully transparent PNG becomes white, not black', (await corners((await prepareProfilePhoto(clearFile)).dataUrl)) === 'WWWW', await corners((await prepareProfilePhoto(clearFile)).dataUrl));
  const halfClear = canvasOf(400, 400);
  halfClear.getContext('2d').fillStyle = COLOURS.R; halfClear.getContext('2d').fillRect(0, 0, 200, 400);
  const halfFile = fileOf(await bytesOfBlob(await toBlob(halfClear, 'image/png')), 'half.png', 'image/png');
  check('a half-transparent PNG keeps its colour and flattens the rest to white', (await corners((await prepareProfilePhoto(halfFile)).dataUrl)) === 'RWRW', await corners((await prepareProfilePhoto(halfFile)).dataUrl));

  // 8. Things that go wrong.
  const goodJpeg = await bytesOfBlob(await toBlob(quadrants(800, 600), 'image/jpeg', 0.9));
  const random = new Uint8Array(5000).map((_, i) => (i * 131 + 17) & 0xFF);
  const cases = [
    ['a JPEG cut off after its header is damaged', goodJpeg.slice(0, 120), 'cut.jpg', 'image/jpeg', PHOTO_ERRORS.DECODE_FAILED],
    ['random bytes called a JPEG are damaged', random, 'r.jpg', 'image/jpeg', PHOTO_ERRORS.DECODE_FAILED],
    ['random bytes called a PNG are damaged', random, 'r.png', 'image/png', PHOTO_ERRORS.DECODE_FAILED],
    ['random bytes called a WebP are damaged', random, 'r.webp', 'image/webp', PHOTO_ERRORS.DECODE_FAILED],
    ['text called a JPEG is damaged', new TextEncoder().encode('this is not a picture'.repeat(20)), 't.jpg', 'image/jpeg', PHOTO_ERRORS.DECODE_FAILED],
    ['an empty file is damaged', new Uint8Array(0), 'e.jpg', 'image/jpeg', PHOTO_ERRORS.DECODE_FAILED],
    ['a PDF is not a picture', new TextEncoder().encode('%PDF-1.4'), 'a.pdf', 'application/pdf', PHOTO_ERRORS.UNSUPPORTED_FORMAT],
    ['HEIC the browser cannot open is unsupported', random, 'a.heic', 'image/heic', PHOTO_ERRORS.UNSUPPORTED_FORMAT],
    ['a TIFF the browser cannot open is unsupported', random, 'a.tiff', 'image/tiff', PHOTO_ERRORS.UNSUPPORTED_FORMAT],
    ['63x63 is too small', await bytesOfBlob(await toBlob(quadrants(63, 63), 'image/png')), 's.png', 'image/png', PHOTO_ERRORS.TOO_SMALL],
  ];
  for (const [name, bytes, fileName, type, want] of cases) {
    const got = await failureCode(prepareProfilePhoto(fileOf(bytes, fileName, type)));
    check(name, got === want, `${got}, wanted ${want}`);
  }
  const tooZoomed = await failureCode(prepareProfilePhoto(fileOf(await bytesOfBlob(await toBlob(quadrants(400, 400), 'image/png')), 'z.png', 'image/png'), { crop: { zoom: 8 } }));
  check('zooming in past 64 px of the picture is too small', tooZoomed === PHOTO_ERRORS.TOO_SMALL, tooZoomed);

  // 9. Only what was asked for left the page.
  check('a finished photo is a string and nothing else is kept on the page', typeof tagged.dataUrl === 'string' && Object.keys(tagged).sort().join() === 'attempts,bytes,chars,crop,dataUrl,heightPx,mimeType,widthPx', Object.keys(tagged).join());
}

run().catch((error) => check('the checks ran to the end', false, error?.stack ?? error)).finally(() => {
  window.__photoResults = results;
  document.documentElement.dataset.ready = '1';
});
