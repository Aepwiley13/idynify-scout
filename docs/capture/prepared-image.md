# Prepared card image (`card-image/v1`)

Image preparation in the browser (PR 5) produces exactly one object, and the extraction endpoint (PR 6) accepts exactly that object as the `image` field of its request. Neither side has its own format. The shape, limits, warning codes and error codes live in `src/capture/preparedImage.js`, which both sides import. That file has no dependencies, so the browser and the server run the same checks.

## The object

```
{
  version:  'card-image/v1',
  mimeType: 'image/jpeg',
  data:     '<standard base64 of the JPEG bytes>',
  bytes:    1048576,
  widthPx:  2000,
  heightPx: 1500,
  preflight: {
    blur:         142.5,
    brightness:   131.2,
    glareRatio:   0.004,
    warnings:     ['glare'],
    userOverrode: true
  }
}
```

| Field | Rule |
|---|---|
| `version` | Exactly `card-image/v1`. Anything else is `unsupported_version` |
| `mimeType` | Exactly `image/jpeg`. HEIC, PNG and WebP are never sent (`not_jpeg`) |
| `data` | Standard base64 (RFC 4648, padded) of the JPEG file. No `data:` prefix, no whitespace, no line breaks. Its length is exactly `4 × ceil(bytes / 3)` |
| `bytes` | The decoded length in bytes, from 1 to 1,500,000 (`too_large` above that). Must equal the decoded data (`invalid_encoding` otherwise) |
| `widthPx`, `heightPx` | Integers, the size encoded in the JPEG header (`dimensions_mismatch` otherwise). Long edge ≤ 2,000 (`too_large`), short edge ≥ 600 (`too_small`) |
| `preflight` | Exactly the five keys below. This is the same object as CardExtraction's `capture.image.preflight`, so the endpoint passes it through unchanged |

No other keys are allowed at either level. File names, timestamps and camera details are rejected rather than ignored.

### Preflight

| Key | Meaning |
|---|---|
| `blur` | Variance of the Laplacian on a 512 px-wide grayscale copy. Lower is blurrier |
| `brightness` | Mean luma, 0–255 |
| `glareRatio` | Share of pixels in the central 80% with luma ≥ 250, 0–1 |
| `warnings` | Any of `blurry`, `glare`, `dark`, each at most once, in that order. Empty when the photo passed |
| `userOverrode` | `true` only when there were warnings and the user chose **Use anyway**. `true` with no warnings is invalid |

Each warning offers **Retake** (primary) and **Use anyway**. "Too small" is never a warning: it stops the photo before upload. When `userOverrode` is true, the extraction caps that scan's field levels at `likely`.

## Guarantees beyond the shape

- **Upright.** Orientation is applied to the pixels when the photo is decoded, and the JPEG carries no orientation tag. The extractor sees the card the right way up.
- **Metadata-free.** No segments besides APP0 (JFIF) and APP14 (Adobe colour), so no EXIF, GPS, XMP, IPTC, ICC, maker notes or comments.
  - The browser's canvas re-encode writes none, and PR 5 asserts its own output before upload.
  - The server strips any it finds before the image goes anywhere, and records only how many segments it removed. Seeing any at all means a client bug.
- **One encode.** The JPEG is the first and only encode of the decoded photo: quality 0.85, falling back to 0.75 and then to 1,600 px at 0.80 to fit 1.5 MB. Re-encoding blurs small text.
- **Never stored or logged.** The image exists in browser memory and the request body only, and goes from there to the extraction provider. No log line, usage row or operation record carries the image, the base64, or any value read from it.

## Error codes

One vocabulary for both sides. The browser raises the first four while preparing a photo. The server returns any of them as `400 { "error": "image_rejected", "reason": "<code>" }`.

| Code | When |
|---|---|
| `unsupported_format` | HEIC/HEIF, or a file the browser cannot decode as an image |
| `decode_failed` | The file could not be read |
| `too_small` | Short edge under 600 px after orientation |
| `too_large` | Over 1.5 MB after the fallbacks, or long edge over 2,000 px |
| `not_jpeg` | Wrong `mimeType`, or the bytes are not a JPEG |
| `invalid_encoding` | Malformed base64, `bytes` not matching the data, a missing or extra key |
| `dimensions_mismatch` | `widthPx` / `heightPx` differ from the JPEG header |
| `unsupported_version` | Not `card-image/v1` |
| `invalid_preflight` | Preflight missing, extra keys, values out of range, warnings out of order, or **Use anyway** with no warning |

A change to any of this is a new version (`card-image/v2`), changed in `preparedImage.js` and here, never in only one of the two PRs.
