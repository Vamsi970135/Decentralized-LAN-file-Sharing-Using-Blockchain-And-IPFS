
const crypto = require('crypto');
const db = require('../database.js');

function hashBlock(idx, timestamp, data, previousHash) {
    return crypto.createHash('sha256')
        .update(idx + timestamp + data + previousHash)
        .digest('hex');
}

function addBlock(action) {

    db.get("SELECT * FROM blocks ORDER BY id DESC LIMIT 1", (err, last) => {

        let idx = 1;
        let previousHash = "0";

        if (last) {
            idx = last.idx + 1;
            previousHash = last.hash;
        }

        const timestamp = new Date().toISOString();
        const data = JSON.stringify(action);
        const hash = hashBlock(idx, timestamp, data, previousHash);

        db.run(
            "INSERT INTO blocks(idx,timestamp,data,previousHash,hash) VALUES(?,?,?,?,?)",
            [idx, timestamp, data, previousHash, hash]
        );
    });
}

module.exports = { addBlock };
