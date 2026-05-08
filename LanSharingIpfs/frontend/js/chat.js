/**
 * chat.js — Full LAN peer-to-peer chat.
 * Messages go: Browser → Socket.IO → Local Server → HTTP relay → Remote Server → Socket.IO → Browser
 */
document.addEventListener("DOMContentLoaded", () => {

    const socket    = window.GlobalSocket.getSocket();
    const myUserId  = window.GlobalSocket.getUserId();

    const peerListEl     = document.getElementById("peer-list");
    const noPeers        = document.getElementById("no-peers");
    const startBtn       = document.getElementById("start-chat");
    const sendBtn        = document.getElementById("send-btn");
    const shareCidBtn    = document.getElementById("share-cid-btn");
    const input          = document.getElementById("chat-input");
    const chatMessages   = document.getElementById("chat-messages");
    const chatHeader     = document.getElementById("chat-header");
    const connectionStat = document.getElementById("connection-status");
    const cidModal       = document.getElementById("cid-modal");
    const cidList        = document.getElementById("cid-list");
    const closeCidModal  = document.getElementById("close-cid-modal");
    const emptyState     = document.getElementById("empty-state");

    let selectedPeer = null; // { userId, username, ip, port }

    // ── Restore peer from localStorage (redirect from peers.html / incoming-chat) ──
    const savedPeerId   = localStorage.getItem("chatPeer");
    const savedPeerName = localStorage.getItem("chatPeerName");
    const savedPeerIp   = localStorage.getItem("chatPeerIp");
    const savedPeerPort = localStorage.getItem("chatPeerPort");

    if (savedPeerId && savedPeerName) {
        selectedPeer = {
            userId:   savedPeerId,
            username: savedPeerName,
            ip:       savedPeerIp   || "",
            port:     parseInt(savedPeerPort) || 5000
        };
        activateChat(selectedPeer);
        localStorage.removeItem("chatPeer");
        localStorage.removeItem("chatPeerName");
        localStorage.removeItem("chatPeerIp");
        localStorage.removeItem("chatPeerPort");
    }

    // ── Message rendering ──────────────────────────────────────────────────────
    function addMessage(text, sender, sent, type, filename) {
        if (emptyState) emptyState.style.display = "none";

        const row    = document.createElement("div");
        row.className = sent ? "msg-row-sent" : "msg-row-received";

        const bubble = document.createElement("div");
        bubble.className = sent ? "bubble-sent" : "bubble-received";

        if (type === "cid") {
            const downloadUrl = "download.html?cid=" + encodeURIComponent(text);
            bubble.innerHTML = `
                <div class="sender-label">${sender}</div>
                <div class="cid-card">
                    <div class="cid-card-filename">
                        <svg style="width:14px;height:14px;display:inline;margin-right:5px;vertical-align:middle" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        ${filename || 'Shared File'}
                    </div>
                    <div class="cid-hash">CID: ${text}</div>
                    <a href="${downloadUrl}" class="download-btn">📥 Download File</a>
                    <div class="cid-sub">Click to decrypt &amp; download</div>
                </div>`;
        } else {
            bubble.innerHTML = `<div class="sender-label">${sender}</div><div>${text}</div>`;
        }

        row.appendChild(bubble);
        chatMessages.appendChild(row);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function addSystemMessage(text) {
        const div = document.createElement("div");
        div.className = "sys-msg";
        div.textContent = text;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function activateChat(peer) {
        selectedPeer = peer;
        if (chatHeader)     chatHeader.textContent    = peer.username;
        if (connectionStat) connectionStat.textContent = peer.ip + ":" + peer.port;

        const avatar = document.getElementById("peer-avatar");
        if (avatar) avatar.textContent = peer.username.charAt(0).toUpperCase();

        const badge = document.getElementById("online-badge");
        if (badge) badge.style.display = "flex";

        sendBtn.disabled    = false;
        shareCidBtn.disabled = false;
        input.disabled      = false;
        input.focus();
        addSystemMessage("💬 Chatting with " + peer.username + " · " + peer.ip + ":" + peer.port);
    }

    // ── Peer list rendering ────────────────────────────────────────────────────
    function renderPeerList(peers) {
        // Normalize: socket events use .userId, REST poll uses .id
        peers = (peers || []).map(p => ({ ...p, userId: p.userId || p.id }));

        // Filter out self
        const filtered = peers.filter(p => String(p.userId) !== String(myUserId));

        peerListEl.innerHTML = "";

        if (filtered.length === 0) {
            noPeers.style.display = "block";
            startBtn.disabled = true;
            return;
        }
        noPeers.style.display = "none";

        filtered.forEach(peer => {
            const div = document.createElement("div");
            div.className = "peer-item";
            div.dataset.peerId = peer.userId;
            div.innerHTML = `
                <div class="peer-avatar">${peer.username.charAt(0).toUpperCase()}</div>
                <div style="flex:1;min-width:0">
                    <div class="peer-name">${peer.username}</div>
                    <div class="peer-online"><span class="dot-green"></span>Online</div>
                    <div class="peer-ip">${peer.ip}</div>
                </div>`;

            div.onclick = () => {
                document.querySelectorAll(".peer-item").forEach(p => p.classList.remove("selected"));
                div.classList.add("selected");
                startBtn.disabled = false;
                startBtn._pendingPeer = {
                    userId:   peer.userId,
                    username: peer.username,
                    ip:       peer.ip,
                    port:     peer.port || 5000
                };
            };

            peerListEl.appendChild(div);

            // Re-highlight if already chatting with this peer
            if (selectedPeer && String(peer.userId) === String(selectedPeer.userId)) {
                div.classList.add("selected");
            }
        });
    }

    socket.on("lan-peers", (peers) => renderPeerList(peers));

    // Poll as fallback every 5s
    async function pollPeers() {
        try {
            const res = await fetch("/api/files/peers");
            const data = await res.json();
            renderPeerList(data.peers || []);
        } catch (e) {}
    }
    pollPeers();
    setInterval(pollPeers, 5000);

    // ── Start Chat button ──────────────────────────────────────────────────────
    startBtn.onclick = () => {
        const peer = startBtn._pendingPeer;
        if (!peer) return;
        activateChat(peer);
        startBtn.disabled = true;
    };

    // ── Send message ───────────────────────────────────────────────────────────
    sendBtn.onclick  = sendMessage;
    input.onkeydown  = (e) => { if (e.key === "Enter" && !e.shiftKey) sendMessage(); };

    function sendMessage() {
        if (!selectedPeer) { showToast("Select a peer first"); return; }
        const msg = input.value.trim();
        if (!msg) return;

        socket.emit("send-message", {
            toPeerIp:   selectedPeer.ip,
            toPeerPort: selectedPeer.port,
            toUserId:   selectedPeer.userId,
            message:    msg
        });

        addMessage(msg, "You", true, "text");
        input.value = "";
    }

    // ── Receive message ────────────────────────────────────────────────────────
    socket.on("receive-message", async (data) => {
        addMessage(data.message, data.from, false, data.type || "text", data.filename);

        // Auto-register CID so we can download it
        if (data.type === "cid" && data.message && data.key) {
            try {
                const token = localStorage.getItem("token");
                await fetch("/api/files/register-cid", {
                    method: "POST",
                    headers: {
                        "Content-Type":  "application/json",
                        "Authorization": "Bearer " + token
                    },
                    body: JSON.stringify({
                        cid:       data.message,
                        key:       data.key,
                        filename:  data.filename || "shared-file",
                        size:      data.size     || 0,
                        ownerIp:   data.ownerIp   || data.fromIp   || "",
                        ownerPort: data.ownerPort || data.fromPort || 5000
                    })
                });
            } catch(e) {
                console.warn("[Chat] Could not auto-register CID:", e.message);
            }
        }
    });

    socket.on("relay-error", (data) => {
        showToast("⚠️ " + data.message, true);
    });

    // ── Share CID modal ────────────────────────────────────────────────────────
    shareCidBtn.onclick = async () => {
        if (!selectedPeer) { showToast("Select a peer first"); return; }
        cidList.innerHTML = "<p style='color:#94a3b8;font-size:0.82rem;text-align:center;padding:20px 0'>Loading files…</p>";
        cidModal.classList.remove("hidden");

        try {
            const token = localStorage.getItem("token");
            const res   = await fetch("/api/files/my-files", {
                headers: { Authorization: "Bearer " + token }
            });
            const data  = await res.json();
            const files = data.files || [];

            if (files.length === 0) {
                cidList.innerHTML = "<p style='color:#94a3b8;font-size:0.82rem;text-align:center;padding:20px 0'>No uploaded files found.<br>Upload a file first.</p>";
                return;
            }

            cidList.innerHTML = "";
            files.forEach(file => {
                const btn = document.createElement("button");
                btn.className = "cid-file-btn";
                btn.innerHTML = `
                    <div class="cid-file-icon">
                        <svg width="20" height="20" fill="none" stroke="#2563eb" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                    </div>
                    <div style="overflow:hidden;flex:1">
                        <div class="cid-file-name">${file.filename}</div>
                        <div class="cid-file-meta" style="font-family:monospace">CID: ${file.cid.slice(0,20)}…</div>
                        <div class="cid-file-meta">${formatBytes(file.size)}</div>
                    </div>
                    <svg width="16" height="16" fill="none" stroke="#3b82f6" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                    </svg>`;
                btn.onclick = () => shareCid(file.cid, file.filename, file.key || "", file.size || 0);
                cidList.appendChild(btn);
            });
        } catch (e) {
            cidList.innerHTML = "<p style='color:#ef4444;font-size:0.82rem;text-align:center;padding:20px 0'>Failed to load files.</p>";
        }
    };

    closeCidModal.onclick = () => cidModal.classList.add("hidden");
    cidModal.onclick = (e) => { if (e.target === cidModal) cidModal.classList.add("hidden"); };

    function shareCid(cid, filename, key, size) {
        if (!selectedPeer) return;
        socket.emit("send-cid", {
            toPeerIp:   selectedPeer.ip,
            toPeerPort: selectedPeer.port,
            toUserId:   selectedPeer.userId,
            cid, filename, key, size
        });
        addMessage(cid, "You", true, "cid", filename);
        cidModal.classList.add("hidden");
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    function formatBytes(bytes) {
        if (!bytes) return "Unknown size";
        if (bytes < 1024)            return bytes + " B";
        if (bytes < 1024 * 1024)     return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function showToast(msg, isError) {
        const t = document.createElement("div");
        t.className = "toast";
        t.style.background = isError ? "#ef4444" : "#1e293b";
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }
});
