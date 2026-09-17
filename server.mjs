#!/usr/bin/env node
/**
 * Local demo server for C2PA validation on top of the Dolby OptiView Player (formerly THEOplayer) `c2pametadata` API.
 *
 * - Serves `index.html` (the demo page) and the OptiView Player Web SDK build (THEOplayer.js).
 * - Exposes `POST /validate`: receives the captured initialization segment + media segments
 *   (base64) from the page and validates them with c2patool (the C2PA reference implementation).
 *
 * Usage:
 *   node server.mjs [--player <dir-or-url>] [--port <port>] [--verify-trust]
 *
 *   --player        Directory with the THEOplayer Web SDK build (THEOplayer.js, ui.css, ...),
 *                   or an https URL of a hosted build. Default: ../web/release
 *   --port          HTTP port. Default: 8765
 *   --verify-trust  Enable the C2PA trust-list check. Off by default, because the public test
 *                   stream is signed with the C2PA *test* certificate (not on the trust list).
 *
 * Requires: Node.js >= 18 and c2patool on PATH (`cargo install c2patool`).
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
    const index = process.argv.indexOf(name);
    return index !== -1 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const port = Number(arg('--port', process.env.PORT ?? '8765'));
const playerLocation = arg('--player', process.env.THEOPLAYER_DIR ?? resolve(here, '../web/release'));
const verifyTrust = process.argv.includes('--verify-trust');
const playerIsUrl = /^https?:\/\//.test(playerLocation);
const playerDir = playerIsUrl ? undefined : resolve(playerLocation);

const c2patoolVersion = spawnSync('c2patool', ['--version'], { encoding: 'utf8' });
const c2patoolAvailable = c2patoolVersion.status === 0;

if (!playerIsUrl && !existsSync(join(playerDir, 'THEOplayer.js'))) {
    console.error(`THEOplayer.js not found in ${playerDir}. Pass --player <dir> pointing at a Web SDK build.`);
    process.exit(1);
}
if (!c2patoolAvailable) {
    console.warn('WARNING: c2patool not found on PATH. The page will run, but validation will fail. Install with: cargo install c2patool');
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
};

function sendFile(res, filePath) {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

/**
 * Validate one initialization segment plus N media segments with c2patool "fragment" mode.
 * `tamperIndex` (optional) flips one byte in that media segment to simulate a MITM modification.
 */
function validate({ initialization, segments, tamperIndex }) {
    const dir = mkdtempSync(join(tmpdir(), 'c2pa-demo-'));
    try {
        writeFileSync(join(dir, 'init.mp4'), Buffer.from(initialization, 'base64'));
        segments.forEach((segment, index) => {
            const bytes = Buffer.from(segment, 'base64');
            if (tamperIndex === index && bytes.length > 100) {
                bytes[bytes.length - 100] = (bytes[bytes.length - 100] + 1) % 256;
            }
            writeFileSync(join(dir, `media${String(index).padStart(5, '0')}.m4s`), bytes);
        });
        writeFileSync(join(dir, 'settings.toml'), `[verify]\nverify_trust = ${verifyTrust}\n`);
        const started = Date.now();
        const result = spawnSync(
            'c2patool',
            ['--settings', join(dir, 'settings.toml'), join(dir, 'init.mp4'), 'fragment', '--fragments_glob', 'media*.m4s'],
            { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
        );
        const stdout = result.stdout ?? '';
        const stderr = (result.stderr ?? '').split('\n').filter((line) => !line.includes(' INFO ')).join('\n');
        let report;
        const jsonStart = stdout.indexOf('{');
        if (jsonStart !== -1) {
            try {
                report = JSON.parse(stdout.slice(jsonStart));
            } catch {
                report = undefined;
            }
        }
        // On a failed segment hash, c2patool prints the failing ValidationStatus to stderr instead of a report.
        const failureMatch = /code: "([^"]+)"/.exec(stderr);
        const state = report?.validation_state ?? (failureMatch ? 'Invalid' : 'Unknown');
        const manifest = report?.manifests?.[report.active_manifest];
        return {
            state,
            failureCode: failureMatch?.[1],
            signer: manifest?.signature_info,
            claimGenerator: manifest?.claim_generator,
            title: manifest?.title,
            statuses: report?.validation_results?.activeManifest,
            durationMs: Date.now() - started,
            exitStatus: result.status,
            stderr: stderr.trim(),
            report
        };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
            return sendFile(res, join(here, 'index.html'));
        }
        if (req.method === 'GET' && url.pathname === '/config.json') {
            return sendJson(res, 200, {
                libraryLocation: playerIsUrl ? playerLocation.replace(/\/?$/, '/') : '/theoplayer/',
                c2patool: c2patoolAvailable ? c2patoolVersion.stdout.trim() : null,
                verifyTrust
            });
        }
        if (req.method === 'GET' && url.pathname.startsWith('/theoplayer/') && playerDir !== undefined) {
            const relative = normalize(decodeURIComponent(url.pathname.slice('/theoplayer/'.length)));
            if (relative.startsWith('..')) {
                res.writeHead(403);
                return res.end();
            }
            return sendFile(res, join(playerDir, relative));
        }
        if (req.method === 'POST' && url.pathname === '/validate') {
            if (!c2patoolAvailable) {
                return sendJson(res, 503, { error: 'c2patool is not installed on this machine (cargo install c2patool)' });
            }
            const body = JSON.parse(await readBody(req));
            if (typeof body.initialization !== 'string' || !Array.isArray(body.segments) || body.segments.length === 0) {
                return sendJson(res, 400, { error: 'Expected { initialization: base64, segments: base64[], tamperIndex?: number }' });
            }
            return sendJson(res, 200, validate(body));
        }
        res.writeHead(404);
        res.end('Not found');
    } catch (error) {
        console.error(error);
        sendJson(res, 500, { error: String(error) });
    }
});

server.listen(port, () => {
    console.log(`C2PA demo: http://localhost:${port}/`);
    console.log(`OptiView Player (THEOplayer) build: ${playerIsUrl ? playerLocation : playerDir}`);
    console.log(`c2patool: ${c2patoolAvailable ? c2patoolVersion.stdout.trim() : 'NOT FOUND'} (verify_trust = ${verifyTrust})`);
});
