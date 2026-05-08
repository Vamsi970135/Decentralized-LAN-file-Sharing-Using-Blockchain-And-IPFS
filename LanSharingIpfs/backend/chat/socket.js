const axios = require('axios');
const discovery = require('../lan-discovery');

// userId (string) -> socket
const localUsers = {};
// socketId -> { userId, username }
const socketToUser = {};
// All currently connected sockets (for broadcast relay fallback)
const allSockets = {};

function init(io) {

    discovery.onChange((peers) => {
        io.emit('lan-peers', peers);
    });

    io.on('connection', (socket) => {
        console.log('[Socket] Browser connected:', socket.id);
        allSockets[socket.id] = socket;

        socket.emit('lan-peers', discovery.getActivePeers());

        socket.on('register-user', (data) => {
            const userId   = String(data.userId);
            const username = data.username;

            localUsers[userId] = socket;
            socketToUser[socket.id] = { userId, username };

            // Update UDP broadcast to advertise the real logged-in user
            discovery.updateServerInfo({ username, userId });

            console.log('[Socket] User registered: ' + username + ' (id=' + userId + ')');
            socket.emit('lan-peers', discovery.getActivePeers());
        });

        // ---- Send text message ----
        socket.on('send-message', async (data) => {
            const sender = socketToUser[socket.id];
            if (!sender) return;

            // Local delivery (same server)
            const toId = String(data.toUserId);
            const localTarget = localUsers[toId];
            if (localTarget) {
                localTarget.emit('receive-message', {
                    from: sender.username, fromId: sender.userId,
                    message: data.message, type: 'text'
                });
                localTarget.emit('incoming-chat', {
                    from: sender.username, fromId: sender.userId,
                    fromIp: discovery.getMyInfo().ip, fromPort: discovery.getMyInfo().port
                });
                return;
            }

            // Remote relay
            if (data.toPeerIp && data.toPeerPort) {
                try {
                    await axios.post(
                        'http://' + data.toPeerIp + ':' + data.toPeerPort + '/api/chat/relay',
                        {
                            toUserId:  toId,
                            from:      sender.username,
                            fromId:    sender.userId,
                            fromIp:    discovery.getMyInfo().ip,
                            fromPort:  discovery.getMyInfo().port,
                            message:   data.message,
                            type:      'text'
                        }
                    );
                } catch (e) {
                    console.error('[Socket] Relay failed:', e.message);
                    socket.emit('relay-error', { message: 'Could not reach peer: ' + e.message });
                }
            }
        });

        // ---- Send CID ----
        socket.on('send-cid', async (data) => {
            // data = { toPeerIp, toPeerPort, toUserId, cid, key, filename, size }
            const sender = socketToUser[socket.id];
            if (!sender) return;

            const toId   = String(data.toUserId);
            const myInfo = discovery.getMyInfo();
            const payload = {
                from: sender.username, fromId: sender.userId,
                message:   data.cid,
                filename:  data.filename || 'file',
                key:       data.key || '',
                size:      data.size || 0,
                type:      'cid',
                ownerIp:   myInfo.ip,        // ← sender's IP so peer can fetch file
                ownerPort: myInfo.port || 5000
            };

            const localTarget = localUsers[toId];
            if (localTarget) {
                localTarget.emit('receive-message', payload);
                localTarget.emit('incoming-chat', {
                    from: sender.username, fromId: sender.userId,
                    fromIp: myInfo.ip, fromPort: myInfo.port
                });
                return;
            }

            if (data.toPeerIp && data.toPeerPort) {
                try {
                    await axios.post(
                        'http://' + data.toPeerIp + ':' + data.toPeerPort + '/api/chat/relay',
                        {
                            toUserId:  toId,
                            from:      sender.username,
                            fromId:    sender.userId,
                            fromIp:    myInfo.ip,
                            fromPort:  myInfo.port,
                            message:   data.cid,
                            filename:  data.filename || 'file',
                            key:       data.key || '',
                            size:      data.size || 0,
                            type:      'cid',
                            ownerIp:   myInfo.ip,
                            ownerPort: myInfo.port || 5000
                        }
                    );
                } catch (e) {
                    console.error('[Socket] CID relay failed:', e.message);
                    socket.emit('relay-error', { message: 'Could not reach peer.' });
                }
            }
        });

        socket.on('disconnect', () => {
            const user = socketToUser[socket.id];
            if (user) {
                delete localUsers[user.userId];
                delete socketToUser[socket.id];
                console.log('[Socket] User disconnected: ' + user.username);
            }
            delete allSockets[socket.id];
        });
    });

    // ---- Relay handler ----
    // Called by remote server via POST /api/chat/relay
    return {
        relayMessage: (data) => {
            const toId = String(data.toUserId);

            // Build the message payload — include key if it's a CID share
            const msgPayload = {
                from: data.from, fromId: data.fromId,
                message: data.message, filename: data.filename,
                key: data.key || '',
                size: data.size || 0,
                type: data.type || 'text',
                ownerIp:   data.ownerIp   || data.fromIp   || '',   // ← FIX: was dropped
                ownerPort: data.ownerPort || data.fromPort || 5000  // ← FIX: was dropped
            };
            const chatPayload = {
                from: data.from, fromId: data.fromId,
                fromIp: data.fromIp, fromPort: data.fromPort
            };

            // 1. Try exact userId match
            const target = localUsers[toId];
            if (target) {
                target.emit('receive-message', msgPayload);
                target.emit('incoming-chat', chatPayload);
                return true;
            }

            // 2. Fallback: broadcast to ALL connected browsers on this server
            const socketIds = Object.keys(allSockets);
            if (socketIds.length > 0) {
                console.log('[Socket] userId "' + toId + '" not found, broadcasting to ' + socketIds.length + ' socket(s)');
                socketIds.forEach(sid => {
                    allSockets[sid].emit('receive-message', msgPayload);
                    allSockets[sid].emit('incoming-chat', chatPayload);
                });
                return true;
            }

            return false;
        }
    };
}

module.exports = init;
