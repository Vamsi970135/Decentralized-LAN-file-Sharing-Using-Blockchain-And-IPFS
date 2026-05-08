// ================= LOAD ENV =================
require('dotenv').config();

// ================= IMPORTS =================
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const db = require('./database.js');
const discovery = require('./lan-discovery');

// ----- ROUTES -----
const authRoutes = require('./auth/auth.routes.js');
const fileRoutes = require('./files/files.routes.js');
const initSocket = require('./chat/socket.js');

// ================= APP =================
const app = express();

// ================= MIDDLEWARE =================
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================= SERVE FRONTEND =================
app.use(express.static(path.join(__dirname, '../frontend')));

// ================= API ROUTES =================
app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);

// ================= TEST =================
app.get('/api/test', (req, res) => {
    res.json({ message: "Backend + Upload API Working!" });
});

// =====================================================
// 📊 DASHBOARD STATS API
// =====================================================
app.get("/api/files/stats", (req, res) => {
    db.get("SELECT COUNT(*) as totalFiles FROM files", (err, fileRow) => {
        db.get("SELECT COUNT(*) as totalUsers FROM users", (err, userRow) => {
            db.get("SELECT SUM(size) as totalSize FROM files", (err, sizeRow) => {
                res.json({
                    totalFiles: fileRow ? fileRow.totalFiles : 0,
                    totalUsers: userRow ? userRow.totalUsers : 0,
                    totalSize: sizeRow && sizeRow.totalSize ? sizeRow.totalSize : 0,
                    networkStatus: "Online"
                });
            });
        });
    });
});

// =====================================================
// 📂 FILE HISTORY API
// =====================================================
app.get("/api/files/history", (req, res) => {
    db.all(
        "SELECT filename, size, uploadedAt as createdAt FROM files ORDER BY uploadedAt DESC LIMIT 10",
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            // SQLite CURRENT_TIMESTAMP stores UTC without 'Z' — append it so
            // JS Date parses correctly as UTC (not as local time)
            const fixed = (rows || []).map(r => ({
                ...r,
                createdAt: r.createdAt ? r.createdAt.replace(" ", "T") + "Z" : r.createdAt
            }));
            res.json({ history: fixed });
        }
    );
});

// =====================================================
// 🔗 TRANSACTIONS (BLOCKCHAIN LEDGER)
// =====================================================
app.get("/api/files/transactions", (req, res) => {
    db.all(
        "SELECT * FROM blocks ORDER BY id DESC LIMIT 10",
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json({ transactions: rows || [] });
        }
    );
});

// =====================================================
// 👥 ACTIVE PEERS — now from LAN discovery
// =====================================================
app.get("/api/files/peers", (req, res) => {
    const peers = discovery.getActivePeers().map(p => ({
        id: p.userId,
        username: p.username,
        ip: p.ip,
        port: p.port
    }));
    res.json({ peers });
});

// =====================================================
// 🌐 MY SERVER INFO (so frontend knows own IP)
// =====================================================
app.get("/api/my-info", (req, res) => {
    res.json(discovery.getMyInfo());
});

// =====================================================
// 💬 CHAT RELAY ENDPOINT
// Called by remote servers to deliver messages to local users
// =====================================================
app.post("/api/chat/relay", (req, res) => {
    const data = req.body;
    if (!data || !data.toUserId) {
        return res.status(400).json({ error: "Missing toUserId" });
    }
    const delivered = socketHandler.relayMessage(data);
    if (delivered) {
        res.json({ success: true });
    } else {
        // Still return 200 so the sender does not get a relay-error toast
        // The message was queued/broadcast as best-effort
        res.json({ success: false, warning: "User not found by userId, broadcast attempted" });
    }
});

// =====================================================
// 👤 USER ACTIVITY
// =====================================================
app.get("/api/user-activity/:userId", (req, res) => {
    const userId = req.params.userId;
    const result = {};

    db.all(
        "SELECT filename, cid, size, encryptionKey as key, uploadedAt FROM files WHERE userId=? ORDER BY uploadedAt DESC",
        [userId],
        (err, files) => {
            if (err) return res.status(500).json({ error: "Database error" });
            result.files = files || [];

            db.get(
                "SELECT SUM(size) as total FROM files WHERE userId=?",
                [userId],
                (err, sizeRow) => {
                    result.totalSize = sizeRow?.total || 0;

                    db.all(
                        "SELECT * FROM blocks ORDER BY id DESC LIMIT 10",
                        (err, blocks) => {
                            result.transactions = blocks || [];
                            res.json(result);
                        }
                    );
                }
            );
        }
    );
});

// =====================================================
// 📂 MY FILES (for CID sharing in chat)
// =====================================================
app.get("/api/files/my-files", (req, res) => {
    const authHeader = req.headers["authorization"];
    let userId = 1;

    if (authHeader) {
        try {
            const token = authHeader.split(" ")[1];
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            userId = payload.id;
        } catch(e) {}
    }

    db.all(
        "SELECT filename, cid, size, encryptionKey as key, uploadedAt FROM files WHERE userId=? ORDER BY uploadedAt DESC",
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: "Database error" });
            res.json({ files: rows || [] });
        }
    );
});

// ================= SOCKET.IO =================
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const socketHandler = initSocket(io);

// ================= START SERVER =================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log("===========================================");
    console.log("🚀 Secure LAN File Share Server Started");
    console.log("🌐 Open Browser → http://localhost:" + PORT);
    console.log("📡 Socket.IO + Auth + Upload + LAN Discovery Ready");
    console.log("===========================================");

    // Start LAN UDP peer discovery
    discovery.start({ port: PORT, username: 'Server', userId: 'server' });
});
