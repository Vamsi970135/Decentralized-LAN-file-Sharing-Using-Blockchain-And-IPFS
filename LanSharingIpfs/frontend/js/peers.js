/**
 * peers.js — Shows live LAN peers discovered via UDP broadcast.
 * Peers are received from the server via Socket.IO 'lan-peers' event.
 */
document.addEventListener("DOMContentLoaded", () => {

    const socket = window.GlobalSocket.getSocket();
    const peerList = document.getElementById("peer-list");
    const noPeers = document.getElementById("no-peers");
    const peerCount = document.getElementById("peer-count");

    function renderPeers(peers) {
        peerList.innerHTML = "";

        if (!peers || peers.length === 0) {
            if (noPeers) noPeers.style.display = "flex";
            if (peerCount) peerCount.textContent = "0 peers online";
            return;
        }

        if (noPeers) noPeers.style.display = "none";
        if (peerCount) peerCount.textContent = peers.length + " peer" + (peers.length > 1 ? "s" : "") + " online";

        peers.forEach(peer => {
            const div = document.createElement("div");
            div.className = "peer-list-item flex items-center justify-between";

            div.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-white/30 flex items-center justify-center text-white font-bold text-lg">
                        ${peer.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p class="text-white font-semibold">${peer.username}</p>
                        <p class="text-blue-200 text-sm flex items-center gap-1">
                            <span class="w-2 h-2 bg-green-400 rounded-full inline-block animate-pulse"></span>
                            Online &nbsp;·&nbsp; <span class="font-mono text-xs">${peer.ip}:${peer.port}</span>
                        </p>
                    </div>
                </div>
                <button onclick="startChat('${peer.userId}', '${peer.username}', '${peer.ip}', ${peer.port})"
                    class="bg-white/20 hover:bg-white/40 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all flex items-center gap-2 border border-white/30">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                    </svg>
                    Chat
                </button>
            `;

            peerList.appendChild(div);
        });
    }

    // Listen for real-time peer updates from server
    socket.on("lan-peers", (peers) => {
        renderPeers(peers);
    });

    // Also poll as fallback every 5 seconds
    async function pollPeers() {
        try {
            const res = await fetch("/api/files/peers");
            const data = await res.json();
            renderPeers(data.peers || []);
        } catch (e) {}
    }

    pollPeers();
    setInterval(pollPeers, 5000);

});

function startChat(peerId, peerName, peerIp, peerPort) {
    localStorage.setItem("chatPeer", peerId);
    localStorage.setItem("chatPeerName", peerName);
    localStorage.setItem("chatPeerIp", peerIp);
    localStorage.setItem("chatPeerPort", peerPort);
    window.location.href = "chat.html";
}
