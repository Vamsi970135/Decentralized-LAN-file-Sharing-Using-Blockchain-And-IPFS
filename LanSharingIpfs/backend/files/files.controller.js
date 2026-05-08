const db         = require('../database.js');
const mime       = require('mime-types');
const CryptoJS   = require('crypto-js');
const axios      = require('axios');
const discovery  = require('../lan-discovery');

const { uploadToIPFS, readLocal } = require('../config/ipfs.js');
const { addBlock }                = require('../ledger/blockchain.js');

// ─────────────────────────────────────────────────────────────
// UPLOAD FILE  (stores encrypted file locally, returns UUID as CID)
// ─────────────────────────────────────────────────────────────
exports.uploadFile = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        let userId = 1;
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            try {
                const token   = authHeader.split(' ')[1];
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                userId = payload.id;
            } catch(e) {}
        }

        // Generate AES key + encrypt
        const key         = CryptoJS.lib.WordArray.random(16).toString();
        const base64Data  = req.file.buffer.toString('base64');
        const encrypted   = CryptoJS.AES.encrypt(base64Data, key).toString();
        const encBuf      = Buffer.from(encrypted);

        // Save to local disk — returns UUID as "CID"
        const cid = await uploadToIPFS(encBuf, req.file.originalname);

        // Save metadata to DB
        db.run(
            'INSERT INTO files(userId, filename, cid, size, encryptionKey) VALUES(?,?,?,?,?)',
            [userId, req.file.originalname, cid, req.file.size, key]
        );

        addBlock({ action: 'UPLOAD', filename: req.file.originalname, cid, size: req.file.size, timestamp: new Date().toISOString() });
        console.log('File uploaded:', req.file.originalname, '| CID:', cid);

        res.json({ message: 'File uploaded successfully', cid, key });

    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: 'Upload failed: ' + err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// REGISTER CID  (Peer B saves a received CID+key+ownerIp into DB)
// ─────────────────────────────────────────────────────────────
exports.registerCid = (req, res) => {
    const { cid, key, filename, size, ownerIp, ownerPort } = req.body;

    if (!cid || !key || !filename) {
        return res.status(400).json({ error: 'cid, key, and filename are required' });
    }

    let userId = 1;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        try {
            const token   = authHeader.split(' ')[1];
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            userId = payload.id;
        } catch(e) {}
    }

    db.get('SELECT id, ownerIp FROM files WHERE cid=?', [cid], (err, row) => {
        // If already registered WITH a valid ownerIp, skip
        if (row && row.ownerIp) return res.json({ message: 'CID already registered', cid });

        // If registered but ownerIp was blank/null — UPDATE it now
        if (row && !row.ownerIp && ownerIp) {
            db.run(
                'UPDATE files SET ownerIp=?, ownerPort=? WHERE cid=?',
                [ownerIp, ownerPort || 5000, cid],
                (err) => {
                    if (err) console.error('registerCid update error:', err);
                    else console.log('CID ownerIp updated:', cid, '→', ownerIp);
                }
            );
            return res.json({ message: 'CID owner info updated', cid });
        }

        db.run(
            'INSERT INTO files(userId, filename, cid, size, encryptionKey, ownerIp, ownerPort) VALUES(?,?,?,?,?,?,?)',
            [userId, filename, cid, size || 0, key, ownerIp || null, ownerPort || 5000],
            function(err) {
                if (err) { console.error('registerCid error:', err); return res.status(500).json({ error: 'Failed to register CID' }); }
                console.log('CID registered from peer:', filename, '|', cid, '| owner:', ownerIp);
                res.json({ message: 'CID registered successfully', cid });
            }
        );
    });
};

// ─────────────────────────────────────────────────────────────
// DOWNLOAD FILE
//   1. Try to serve from own disk (uploader's machine)
//   2. Fall back to fetching from ownerIp over LAN
// ─────────────────────────────────────────────────────────────
exports.downloadFile = async (req, res) => {
    try {
        const cid = req.params.cid;

        db.get(
            'SELECT filename, encryptionKey, ownerIp, ownerPort FROM files WHERE cid=?',
            [cid],
            async (err, row) => {
                if (err)  return res.status(500).json({ message: 'Database error' });
                if (!row) return res.status(404).json({
                    message: 'File not found in this device\'s database. Use "Register CID" tab to add it first.'
                });

                const { filename, encryptionKey: key, ownerIp, ownerPort } = row;
                const contentType = mime.lookup(filename) || 'application/octet-stream';

                let encryptedText = null;

                // ── Try local disk first ──────────────────────────────────
                try {
                    const buf = readLocal(cid);
                    encryptedText = buf.toString();
                    console.log('[Download] Served from local disk:', filename);
                } catch(e) {
                    console.log('[Download] Not on local disk, trying LAN peer...');
                }

                // ── Try fetching raw encrypted file from owner over LAN ───
                if (!encryptedText && ownerIp) {
                    const port = ownerPort || 5000;
                    const url  = `http://${ownerIp}:${port}/api/files/raw/${cid}`;
                    try {
                        const r = await axios.get(url, { responseType: 'text', timeout: 15000 });
                        encryptedText = r.data;
                        console.log('[Download] Fetched from LAN peer:', ownerIp, filename);
                    } catch(e) {
                        console.warn('[Download] LAN fetch failed:', e.message);
                    }
                }

                if (!encryptedText) {
                    return res.status(500).json({
                        message: `Could not retrieve file. The owner machine (${ownerIp || 'unknown'}) may be offline or unreachable on the LAN.`
                    });
                }

                // ── Decrypt ───────────────────────────────────────────────
                try {
                    const decrypted = CryptoJS.AES.decrypt(encryptedText, key);
                    const base64Data = decrypted.toString(CryptoJS.enc.Utf8);
                    if (!base64Data) return res.status(500).json({ message: 'Decryption failed — wrong key or corrupted file' });

                    const originalBuffer = Buffer.from(base64Data, 'base64');
                    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                    res.setHeader('Content-Type', contentType);

                    addBlock({ action: 'DOWNLOAD', filename, cid, timestamp: new Date().toISOString() });
                    res.send(originalBuffer);
                } catch(e) {
                    res.status(500).json({ message: 'Decryption error: ' + e.message });
                }
            }
        );
    } catch (err) {
        console.error('Download error:', err);
        res.status(500).json({ message: 'Download failed: ' + err.message });
    }
};

// ─────────────────────────────────────────────────────────────
// RAW SERVE  — lets LAN peers fetch encrypted file bytes
// Only works if file is stored on THIS machine's disk
// ─────────────────────────────────────────────────────────────
exports.serveRaw = (req, res) => {
    const cid = req.params.cid;
    try {
        const buf = readLocal(cid);
        res.setHeader('Content-Type', 'text/plain');
        res.send(buf);
    } catch(e) {
        res.status(404).json({ message: 'Raw file not found on this machine' });
    }
};

// ─────────────────────────────────────────────────────────────
// GET MY FILES
// ─────────────────────────────────────────────────────────────
exports.getMyFiles = (req, res) => {
    let userId = 1;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        try {
            const token   = authHeader.split(' ')[1];
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            userId = payload.id;
        } catch(e) {}
    }
    db.all(
        'SELECT id, filename, cid, size, encryptionKey as key FROM files WHERE userId=? ORDER BY id DESC',
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: 'DB error' });
            res.json({ files: rows || [] });
        }
    );
};

// ─────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────
exports.getStats = (req, res) => {
    db.get('SELECT COUNT(*) as totalFiles FROM files', (err, filesRow) => {
        db.get('SELECT COUNT(*) as totalUsers FROM users', (err, usersRow) => {
            db.get('SELECT SUM(size) as totalSize FROM files', (err, sizeRow) => {
                res.json({
                    totalFiles:    filesRow ? filesRow.totalFiles : 0,
                    totalUsers:    usersRow ? usersRow.totalUsers : 0,
                    totalSize:     sizeRow && sizeRow.totalSize ? sizeRow.totalSize : 0,
                    networkStatus: 'Online'
                });
            });
        });
    });
};
