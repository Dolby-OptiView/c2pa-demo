# Dolby OptiView Player — C2PA metadata + validation demo

A local demo page for the `c2pametadata` player event (source option `c2paMetadata: true`).

The page:

1. Plays an HLS or DASH stream (fMP4/CMAF) with a Dolby OptiView Player (formerly THEOplayer) Web SDK build.
2. Shows every `c2pametadata` event from the player (purpose, segmentType, mediaType, time range, raw bytes).
3. Captures the init and media segment bytes with `player.network.addResponseInterceptor`.
4. Sends the bytes to a small local Node server that runs **c2patool** (the C2PA reference implementation).
5. Shows the validation result: Valid / Invalid, signer, claim generator, validation statuses, raw report.

Two validation modes:

- **Validate all captured segments** — genuine stream, expected result `Valid` (signer "C2PA Test Signing Cert").
- **Validate with one tampered segment (MITM)** — one byte of one media segment is changed before validation,
  expected result `Invalid` with `assertion.bmffHash.mismatch`. Playback is not affected by the tampering.

The player never validates anything itself. It only exposes the raw C2PA metadata.

## Requirements

- Node.js 18 or newer.
- `c2patool` on `PATH`: `cargo install c2patool` (needs a Rust toolchain: https://rustup.rs).
  Verify with `c2patool --version` (tested with 0.27.6).
- An OptiView Player Web SDK build (THEOplayer.js) that contains the C2PA feature (branch `feature/OPTIP-422-c2pa-metadata-exposure`
  or a release that includes it). Build it with `npm run build` in `web/`, which produces `web/release/`.
  A hosted build URL also works.

## Run

```bash
# From this directory. Point --player at the Web SDK build directory (contains THEOplayer.js and ui.css).
node server.mjs --player /path/to/theoplayer-next/web/release

# Or use a hosted SDK build:
node server.mjs --player https://example.com/theoplayer/

# Optional: enable the C2PA trust-list check (the public test stream will then report
# signingCredential.untrusted, because it is signed with the C2PA test certificate).
node server.mjs --player ... --verify-trust
```

Then open http://localhost:8765/ and click **Load & play**.

Options: `--port <port>` (default 8765). If the SDK build needs a license, paste it into the License field
(stored in localStorage).

## Default test stream

`https://contentserver.prudentgiraffe.com/videos/hls/c2pa/master.m3u8` — a 4-rendition HLS VOD signed with the
C2PA test certificate. Each init segment carries the C2PA manifest (`uuid` box, purpose `manifest`); each media
segment carries Merkle data (`uuid` box, purpose `merkle`). Any other fMP4/CMAF HLS or DASH stream can be used;
streams without C2PA data produce no events and c2patool reports no manifest.

## Files

- `index.html` — the demo page (player, event table, capture table, validation panel).
- `server.mjs` — static file server + `POST /validate` endpoint that writes the segments to a temp directory and
  runs `c2patool <init> fragment --fragments_glob 'media*.m4s'`.
