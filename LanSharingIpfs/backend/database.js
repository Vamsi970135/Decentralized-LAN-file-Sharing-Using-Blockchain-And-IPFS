const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'database.db'));

db.serialize(() => {
    console.log('Initializing database...');

    db.run(`CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS files(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER,
        filename TEXT,
        cid TEXT,
        size INTEGER,
        encryptionKey TEXT,
        ownerIp TEXT,
        ownerPort INTEGER DEFAULT 5000,
        uploadedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(id)
    )`);

    // Migrate existing databases (safe — errors ignored if columns exist)
    db.run(`ALTER TABLE files ADD COLUMN ownerIp TEXT`, () => {});
    db.run(`ALTER TABLE files ADD COLUMN ownerPort INTEGER DEFAULT 5000`, () => {});

    db.run(`CREATE TABLE IF NOT EXISTS blocks(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idx INTEGER,
        timestamp TEXT,
        data TEXT,
        previousHash TEXT,
        hash TEXT
    )`);

    console.log('Database ready.');
});

module.exports = db;
