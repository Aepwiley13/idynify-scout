/**
 * My Card sharing — the QR code, made in the browser with the open-source `qrcode` package (MIT): no
 * paid service, and the link never leaves the device to be drawn. Black on white at every theme, so any
 * camera reads it; the page around it is white too (see .mycard-qr in MyCard.css).
 */
import QRCode from 'qrcode';

/** A QR code is black on white in every theme so any camera reads it: the screen around it is set to match. */
export const QR_SURFACE = Object.freeze({ '--mycard-qr-bg': '#ffffff', '--mycard-qr-fg': '#000000', '--mycard-qr-note': '#333333' });

/** Medium error correction: robust to a smudge or a screen glare, and still a small, quickly-read code. */
const OPTIONS = Object.freeze({ errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });

/** The QR code for `url` as a PNG data URL, `size` pixels square. */
export async function qrPngDataUrl(url, size = 1024) {
  return QRCode.toDataURL(url, { ...OPTIONS, width: size, type: 'image/png' });
}

/** A safe file name for the downloaded QR code: "Ada_Lovelace_QR.png". */
export function qrFileName(name) {
  const base = String(name ?? '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  return `${base || 'My_Card'}_QR.png`;
}
