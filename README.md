# Dolby OptiView Player — C2PA metadata + validation demo

A browser-based demo page for the `c2pametadata` player event (source option `c2paMetadata: true`).

The page:

1. Plays an HLS or DASH stream (fMP4/CMAF) with Dolby OptiView Player (formerly THEOplayer).
2. Shows every `c2pametadata` event from the player (purpose, segment type, media type, time range, and raw bytes).
3. Captures initialization and media segment bytes with `player.network.addResponseInterceptor`.
4. Validates each media fragment in the browser with [`@contentauth/c2pa-web`](https://github.com/contentauth/c2pa-js/tree/main/packages/c2pa-web).
5. Shows the validation result: Valid / Invalid, signer, claim generator, validation statuses, and raw manifest store.

Two validation modes are available:

- **Validate all captured segments** — validates every captured media fragment against its initialization fragment. The default stream is expected to be `Valid` when trust verification is disabled.
- **Validate with one tampered segment (MITM)** — changes one byte in one media fragment before validation. The expected result is `Invalid` with `assertion.bmffHash.mismatch`. Playback is not affected by the tampering.

The player does not validate C2PA data itself. It exposes the raw metadata and segment responses; `c2pa-web` performs validation in the browser.

## Requirements

- A modern browser with WebAssembly and ES module support.

## Run

Open `index.html` directly or serve it from any static web server, then click **Load & play**.

THEOplayer and `c2pa-web` are loaded as ES modules through an import map. Validation runs entirely in the browser. If the player build needs a license, paste it into the License field; it is stored in `localStorage`.

Use **Verify signing certificate trust** to toggle trust-list verification. It is disabled by default because the default stream uses a C2PA test signing certificate. Enabling it causes that stream to report `signingCredential.untrusted` unless the certificate is trusted by the configured C2PA trust policy.

## Default test stream

`https://cdn.theoplayer.com/video/hls/c2pa/master.m3u8` is a four-rendition HLS VOD signed with a C2PA test certificate. Each initialization fragment carries the C2PA manifest (`uuid` box, purpose `manifest`), and each media fragment carries Merkle data (`uuid` box, purpose `merkle`).

Any other fMP4/CMAF HLS or DASH stream can be used. Streams without C2PA data produce no `c2pametadata` events and cannot be validated by the demo.

## Files

- `index.html` — the complete static demo page, including playback, event inspection, segment capture, and browser-based C2PA validation.
