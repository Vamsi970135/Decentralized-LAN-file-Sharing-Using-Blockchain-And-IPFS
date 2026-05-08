/**
 * LAN Peer Discovery via UDP Broadcast
 * Each server broadcasts its presence every 3 seconds.
 * Other servers on the same WiFi network receive these broadcasts
 * and maintain a live peer registry.
 */

const dgram = require('dgram');
const os = require('os');

const BROADCAST_PORT = 45678;
const BROADCAST_INTERVAL = 3000; // 3 seconds
const PEER_TIMEOUT = 10000;       // remove peer if not heard for 10s

// Store discovered peers: key "ip:port" -> { ip, port, username, userId, lastSeen }
const discoveredPeers = {};

// Callbacks to notify when peer list changes
const changeListeners = [];

let myInfo = {};
let udpSocket = null;

/**
 * Get the best LAN IP — prefers real WiFi/Ethernet, skips VPN/virtual adapters.
 *
 * Priority:
 *  1. Adapter name contains wi-fi, wifi, wlan, wireless, ethernet, en0, eth0
 *  2. IP in 192.168.x.x range
 *  3. IP in 10.x.x.x range
 *  4. Any other non-internal IPv4
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    const preferredNames = ['wi-fi', 'wifi', 'wlan', 'wireless', 'ethernet', 'en0', 'en1', 'eth0', 'eth1'];
    const skipNames     = ['vpn', 'virtual', 'vmware', 'vbox', 'hyper-v', 'loopback',
                           'mcafee', 'tap', 'tun', 'docker', 'wsl', 'hamachi', 'radmin'];

    for (const [name, addrs] of Object.entries(interfaces)) {
        const nameLower = name.toLowerCase();
        if (skipNames.some(s => nameLower.includes(s))) continue;

        for (const iface of addrs) {
            if (iface.family !== 'IPv4' || iface.internal) continue;

            const ip = iface.address;
            let score = 0;
            if (preferredNames.some(s => nameLower.includes(s))) score += 100;
            if (ip.startsWith('192.168.')) score += 50;
            else if (ip.startsWith('10.'))  score += 30;
            else if (ip.startsWith('172.')) score += 10;

            candidates.push({ ip, score, name });
        }
    }

    if (candidates.length === 0) return '127.0.0.1';

    candidates.sort((a, b) => b.score - a.score);

    console.log('[LAN Discovery] Network interfaces detected:');
    candidates.forEach(c => console.log('   [score ' + c.score + '] ' + c.name + ' → ' + c.ip));
    console.log('[LAN Discovery] ✅ Chosen IP: ' + candidates[0].ip + ' (adapter: ' + candidates[0].name + ')');

    return candidates[0].ip;
}

/**
 * Compute broadcast address using IP + subnet mask
 * Falls back to x.x.x.255 if netmask not available
 */
function getBroadcastAddress(ip, netmask) {
    if (netmask) {
        // Proper calculation using bitwise AND + NOT
        const ipParts   = ip.split('.').map(Number);
        const maskParts = netmask.split('.').map(Number);
        return ipParts.map((p, i) => (p | (~maskParts[i] & 255))).join('.');
    }
    // Fallback: replace last octet with 255
    const parts = ip.split('.');
    parts[3] = '255';
    return parts.join('.');
}

/**
 * Find the netmask for a given IP address
 */
function getNetmaskForIP(targetIP) {
    const interfaces = os.networkInterfaces();
    for (const addrs of Object.values(interfaces)) {
        for (const iface of addrs) {
            if (iface.family === 'IPv4' && iface.address === targetIP) {
                return iface.netmask;
            }
        }
    }
    return null;
}

/**
 * Notify all listeners that the peer list changed
 */
function notifyListeners() {
    const peers = getActivePeers();
    changeListeners.forEach(cb => cb(peers));
}

/**
 * Prune peers that haven't announced recently
 */
function pruneStalePeers() {
    const now = Date.now();
    let changed = false;
    for (const key of Object.keys(discoveredPeers)) {
        if (now - discoveredPeers[key].lastSeen > PEER_TIMEOUT) {
            console.log('[LAN Discovery] Peer timed out: ' + discoveredPeers[key].username);
            delete discoveredPeers[key];
            changed = true;
        }
    }
    if (changed) notifyListeners();
}

/**
 * Get currently active peers (excluding self)
 */
function getActivePeers() {
    return Object.values(discoveredPeers).filter(
        p => !(p.ip === myInfo.ip && p.port === myInfo.port)
    );
}

/**
 * Start the UDP discovery service
 * @param {object} info - { port, username, userId }
 */
function start(info) {
    myInfo = {
        ip:       getLocalIP(),
        port:     info.port,
        username: info.username || 'Server',
        userId:   info.userId   || 'server'
    };

    const netmask     = getNetmaskForIP(myInfo.ip);
    const broadcastIP = getBroadcastAddress(myInfo.ip, netmask);

    console.log('[LAN Discovery] My address : ' + myInfo.ip + ':' + myInfo.port);
    console.log('[LAN Discovery] Netmask    : ' + (netmask || 'unknown, using fallback'));
    console.log('[LAN Discovery] Broadcast  : ' + broadcastIP);

    udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    udpSocket.on('error', (err) => {
        if (err.code === 'EACCES' || err.code === 'EADDRINUSE') {
            console.error('[LAN Discovery] ❌ Cannot bind UDP port ' + BROADCAST_PORT + ': ' + err.message);
            console.error('[LAN Discovery] 💡 Fix: Run CMD as Administrator and run:');
            console.error('   netsh advfirewall firewall add rule name="LAN UDP" dir=in action=allow protocol=UDP localport=' + BROADCAST_PORT);
        } else {
            console.error('[LAN Discovery] UDP error:', err.message);
        }
    });

    udpSocket.on('message', (msg, rinfo) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type !== 'lan-peer-announce') return;

            const peer = {
                ip:       data.ip || rinfo.address,
                port:     data.port,
                username: data.username,
                userId:   data.userId,
                lastSeen: Date.now()
            };

            // Skip self
            if (peer.ip === myInfo.ip && peer.port === myInfo.port) return;

            const key = peer.ip + ':' + peer.port;
            const isNew = !discoveredPeers[key];
            discoveredPeers[key] = peer;

            if (isNew) {
                console.log('[LAN Discovery] 🟢 New peer: ' + peer.username + ' @ ' + peer.ip + ':' + peer.port);
                notifyListeners();
            }
        } catch (e) {
            // ignore malformed packets
        }
    });

    udpSocket.bind(BROADCAST_PORT, () => {
        udpSocket.setBroadcast(true);
        console.log('[LAN Discovery] 📡 Listening on UDP port ' + BROADCAST_PORT);

        // Rebuild payload each time so updated username/userId are always sent
        function broadcast() {
            const payload = Buffer.from(JSON.stringify({
                type:     'lan-peer-announce',
                ip:       myInfo.ip,
                port:     myInfo.port,
                username: myInfo.username,
                userId:   myInfo.userId
            }));
            udpSocket.send(payload, 0, payload.length, BROADCAST_PORT, broadcastIP, (err) => {
                if (err) console.error('[LAN Discovery] Broadcast send error:', err.message);
            });
        }

        // Send immediately, then on interval
        broadcast();
        setInterval(() => {
            broadcast();
            pruneStalePeers();
        }, BROADCAST_INTERVAL);
    });
}

/**
 * Update displayed username/userId after a user logs in
 */
function updateServerInfo(info) {
    if (info.username) myInfo.username = info.username;
    if (info.userId)   myInfo.userId   = info.userId;
}

/**
 * Register a callback for when the peer list changes
 */
function onChange(cb) {
    changeListeners.push(cb);
}

/**
 * Get this server's own LAN info
 */
function getMyInfo() {
    return myInfo;
}

module.exports = { start, getActivePeers, onChange, getMyInfo, updateServerInfo, getLocalIP };
