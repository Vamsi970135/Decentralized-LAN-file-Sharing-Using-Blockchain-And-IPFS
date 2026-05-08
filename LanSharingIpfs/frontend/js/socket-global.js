/**
 * Global Socket Manager
 * Connects to the local server via Socket.IO, registers the logged-in user,
 * and handles incoming-chat notifications.
 */
(function () {

    let socket = null;
    let username = null;
    let userId = null;
    let myServerIp = null;
    let myServerPort = null;

    async function init() {
        if (socket) return;

        socket = io();

        socket.on("connect", () => {
            console.log("[Socket] Connected:", socket.id);
        });

        // Decode JWT and register user
        const token = localStorage.getItem("token");
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                username = payload.username;
                userId = payload.id;
                socket.emit("register-user", { userId, username });
            } catch (e) {
                console.warn("[Socket] Token decode failed");
            }
        }

        // Fetch our own server info (IP + port) for routing messages
        try {
            const res = await fetch("/api/my-info");
            const info = await res.json();
            myServerIp = info.ip;
            myServerPort = info.port;
            localStorage.setItem("myServerIp", myServerIp);
            localStorage.setItem("myServerPort", myServerPort);
        } catch (e) {
            console.warn("[Socket] Could not fetch my-info");
        }

        // Auto-redirect when someone sends us a chat message from another page
        socket.on("incoming-chat", (data) => {
            const currentPage = window.location.pathname;
            if (!currentPage.includes("chat.html")) {
                localStorage.setItem("chatPeer", data.fromId);
                localStorage.setItem("chatPeerName", data.from);
                localStorage.setItem("chatPeerIp", data.fromIp || "");
                localStorage.setItem("chatPeerPort", data.fromPort || "");
                if (confirm("💬 New message from " + data.from + "\nOpen chat?")) {
                    window.location.href = "/chat.html";
                }
            }
        });
    }

    // Auto-init
    init();

    window.GlobalSocket = {
        getSocket: () => { if (!socket) init(); return socket; },
        getUsername: () => username,
        getUserId: () => userId,
        getMyIp: () => myServerIp,
        getMyPort: () => myServerPort
    };

})();
