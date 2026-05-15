'use strict';

const https = require('https');
const { performance } = require('perf_hooks');

const DURATION = 10_000;
const URL_COUNT = 8;
const UPLOAD_SIZE = 25 * 1024 * 1024;
const UPLOAD_CHUNK = 16384;
const uploadPayload = Buffer.alloc(UPLOAD_SIZE);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function get(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () => resolve(body));
            })
            .on('error', reject);
    });
}

function fmtMbps(mbps) {
    if (mbps >= 1000) return (mbps / 1000).toFixed(2) + ' Gbps';
    return mbps.toFixed(1) + ' Mbps';
}

// ─── Targets ──────────────────────────────────────────────────────────────────

async function getTargets(TOKEN) {
    const url = `https://api.fast.com/netflix/speedtest/v2?https=true&token=${TOKEN}&urlCount=${URL_COUNT}`;
    const body = await get(url);
    const json = JSON.parse(body);
    if (!json.targets?.length) throw new Error('No targets returned — check your token.');
    return json.targets;
}

function toUploadUrl(downloadUrl) {
    return downloadUrl.replace(/\/range\/\d+-\d+/, '/range/0-0');
}

// ─── Download ─────────────────────────────────────────────────────────────────

function downloadFrom(url, onBytes, signal) {
    return new Promise((resolve) => {
        if (signal.done) return resolve();
        const req = https.get(url, (res) => {
            res.on('data', (chunk) => {
                if (signal.done) {
                    req.destroy();
                    return;
                }
                onBytes(chunk.length);
            });
            res.on('end', resolve);
            res.on('error', resolve);
        });
        req.on('error', resolve);
    });
}

async function runDownload(targets, log) {
    const signal = { done: false };
    let totalBytes = 0;
    const start = performance.now();

    const workers = targets.map((t) => {
        const loop = async () => {
            while (!signal.done)
                await downloadFrom(
                    t.url,
                    (n) => {
                        totalBytes += n;
                    },
                    signal
                );
        };
        return loop();
    });

    await new Promise((r) => setTimeout(r, DURATION));
    signal.done = true;
    await Promise.allSettled(workers);

    const elapsed = (performance.now() - start) / 1000;
    const mbps = (totalBytes * 8) / 1e6 / elapsed;
    log(`Download: ${fmtMbps(mbps)}`);
    return mbps;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

function uploadTo(url, onBytes, signal) {
    return new Promise((resolve) => {
        if (signal.done) return resolve();
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'content-type': 'application/octet-stream',
                'content-length': UPLOAD_SIZE,
                Referer: 'https://fast.com/'
            }
        };
        const req = https.request(options, (res) => {
            res.resume();
            res.on('end', resolve);
            res.on('error', resolve);
        });
        req.on('error', resolve);

        let offset = 0;
        function writeChunk() {
            if (signal.done) {
                req.destroy();
                return resolve();
            }
            let ok = true;
            while (offset < UPLOAD_SIZE && ok) {
                const end = Math.min(offset + UPLOAD_CHUNK, UPLOAD_SIZE);
                onBytes(end - offset);
                ok = req.write(uploadPayload.subarray(offset, end));
                offset = end;
            }
            if (offset < UPLOAD_SIZE) req.once('drain', writeChunk);
            else req.end();
        }
        writeChunk();
    });
}

async function runUpload(targets, log) {
    const signal = { done: false };
    let totalBytes = 0;
    const start = performance.now();

    const workers = targets.map((t) => {
        const uploadUrl = toUploadUrl(t.url);
        const loop = async () => {
            while (!signal.done)
                await uploadTo(
                    uploadUrl,
                    (n) => {
                        totalBytes += n;
                    },
                    signal
                );
        };
        return loop();
    });

    await new Promise((r) => setTimeout(r, DURATION));
    signal.done = true;
    await Promise.allSettled(workers);

    const elapsed = (performance.now() - start) / 1000;
    const mbps = (totalBytes * 8) / 1e6 / elapsed;
    log(`Upload: ${fmtMbps(mbps)}`);
    return mbps;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {boolean} runDownloadTest
 * @param {boolean} runUploadTest
 * @param {Function} log
 * @returns {{ download: number, upload: number, location: { city: string, country: string } | null }}
 */
async function runSpeedTest(runDownloadTest = true, runUploadTest = true, log = console.log, roundDecimals = 2, TOKEN) {
    const targets = await getTargets();
    const loc = targets[0]?.location ?? null;
    if (loc) log(`Server: ${loc.city}, ${loc.country}`);

    let download = 0;
    let upload = 0;

    if (runDownloadTest) {
        log('Running download test...');
        download = await runDownload(targets, log);
    }

    if (runUploadTest) {
        log('Running upload test...');
        upload = await runUpload(targets, log);
    }

    if (roundDecimals !== false) {
        const factor = Math.pow(10, roundDecimals);
        download = Math.round(download * factor) / factor;
        upload = Math.round(upload * factor) / factor;
    }

    return { download, upload, location: loc, speedType: download >= 1000 || upload >= 1000 ? 'Gbps' : 'Mbps', timestamp: Date.now() };
}

module.exports = runSpeedTest;
