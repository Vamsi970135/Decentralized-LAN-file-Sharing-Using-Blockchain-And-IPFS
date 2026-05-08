/**
 * IPFS INTEGRATION via IPFS Desktop HTTP API
 *
 * Requires IPFS Desktop (or ipfs daemon) to be running locally.
 * The daemon exposes an HTTP API on http://127.0.0.1:5001 by default.
 *
 * Files are added to IPFS and a real CIDv0 (Qm...) is returned.
 * The encrypted file is also saved locally as a fallback / for LAN serving.
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');

const UPLOAD_DIR  = path.join(__dirname, '..', 'uploads');
const IPFS_API    = '127.0.0.1';
const IPFS_PORT   = 5001;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/**
 * Add a buffer to IPFS via the local IPFS Desktop HTTP API (/api/v0/add).
 * Returns a real CIDv0 starting with "Qm".
 * Also writes the file to local disk (keyed by CID) for LAN serving.
 */
exports.uploadToIPFS = async (encryptedBuffer, filename) => {
    const cid = await addToIPFS(encryptedBuffer, filename);

    // Save locally for LAN peer downloads (keyed by CID)
    const filePath = path.join(UPLOAD_DIR, cid);
    fs.writeFileSync(filePath, encryptedBuffer);
    console.log('[IPFS] Added to IPFS:', filename, '→ CID:', cid);

    return cid;
};

/**
 * Read the encrypted file from local disk by its CID.
 */
exports.readLocal = (cid) => {
    const filePath = path.join(UPLOAD_DIR, cid);
    if (!fs.existsSync(filePath)) throw new Error('File not found on disk: ' + cid);
    return fs.readFileSync(filePath);
};

exports.UPLOAD_DIR = UPLOAD_DIR;

// ─────────────────────────────────────────────────────────────
// Internal: POST multipart/form-data to IPFS HTTP API
// Uses only Node built-in 'http' — no extra npm deps needed.
// ─────────────────────────────────────────────────────────────
function addToIPFS(buffer, filename) {
    return new Promise((resolve, reject) => {
        const boundary = '----IPFSFormBoundary' + Math.random().toString(16).slice(2);
        const safeFilename = (filename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_');

        const header = Buffer.from(
            '--' + boundary + '\r\n' +
            'Content-Disposition: form-data; name="file"; filename="' + safeFilename + '"\r\n' +
            'Content-Type: application/octet-stream\r\n\r\n'
        );
        const footer = Buffer.from('\r\n--' + boundary + '--\r\n');
        const body   = Buffer.concat([header, buffer, footer]);

        const options = {
            hostname: IPFS_API,
            port:     IPFS_PORT,
            path:     '/api/v0/add?pin=true&quieter=true',
            method:   'POST',
            headers: {
                'Content-Type':   'multipart/form-data; boundary=' + boundary,
                'Content-Length': body.length
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data.trim());
                    if (!json.Hash) {
                        return reject(new Error('IPFS API did not return a Hash. Response: ' + data));
                    }
                    resolve(json.Hash); // This is the real Qm... CID
                } catch (e) {
                    reject(new Error('Failed to parse IPFS response: ' + data));
                }
            });
        });

        req.on('error', (err) => {
            if (err.code === 'ECONNREFUSED') {
                reject(new Error(
                    'IPFS daemon is not running. Please start IPFS Desktop or run "ipfs daemon" first.'
                ));
            } else {
                reject(err);
            }
        });

        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('IPFS request timed out after 30s. Is IPFS Desktop running?'));
        });

        req.write(body);
        req.end();
    });
}
