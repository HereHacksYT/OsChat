const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Veri yapıları
const users = {}; // socketId -> { username, socket }
const userData = {}; // username -> { friends: [], pendingRequests: [] }

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    // Kullanıcı adı belirleme
    socket.on('set username', (username) => {
        // Eski kullanıcı varsa temizle
        if (users[socket.id]) {
            const old = users[socket.id].username;
            if (old && userData[old]) {
                // socket'i güncelle
            }
        }
        users[socket.id] = { username, socket };
        if (!userData[username]) {
            userData[username] = { friends: [], pendingRequests: [] };
        }
        // Kullanıcıya kendi verilerini gönder
        socket.emit('user data', userData[username]);
        broadcastUserList();
        io.emit('user connected', username);
    });

    // Arkadaşlık isteği gönder
    socket.on('friend request', (targetUsername) => {
        const sender = users[socket.id]?.username;
        if (!sender) return;
        if (!userData[targetUsername]) {
            socket.emit('error', 'Kullanıcı bulunamadı.');
            return;
        }
        if (userData[targetUsername].friends.includes(sender)) {
            socket.emit('error', 'Zaten arkadaşsınız.');
            return;
        }
        if (userData[targetUsername].pendingRequests.includes(sender)) {
            socket.emit('error', 'Zaten istek gönderdiniz.');
            return;
        }
        // İsteği ekle
        userData[targetUsername].pendingRequests.push(sender);
        // Hedef kullanıcının socket'ini bul ve bildir
        const targetSocket = Object.values(users).find(u => u.username === targetUsername)?.socket;
        if (targetSocket) {
            targetSocket.emit('new friend request', sender);
        }
        socket.emit('friend request sent', targetUsername);
    });

    // Arkadaşlık isteğini kabul et
    socket.on('accept friend', (requester) => {
        const current = users[socket.id]?.username;
        if (!current) return;
        if (!userData[current]) return;
        const pending = userData[current].pendingRequests;
        const index = pending.indexOf(requester);
        if (index === -1) {
            socket.emit('error', 'Böyle bir istek yok.');
            return;
        }
        pending.splice(index, 1);
        userData[current].friends.push(requester);
        if (!userData[requester]) {
            userData[requester] = { friends: [], pendingRequests: [] };
        }
        userData[requester].friends.push(current);

        // Her iki tarafa da güncel arkadaş listesini gönder
        const currentSocket = users[socket.id]?.socket;
        const requesterSocket = Object.values(users).find(u => u.username === requester)?.socket;
        if (currentSocket) {
            currentSocket.emit('user data', userData[current]);
        }
        if (requesterSocket) {
            requesterSocket.emit('user data', userData[requester]);
        }
        // Ayrıca kabul edildi bildirimi
        if (requesterSocket) {
            requesterSocket.emit('friend request accepted', current);
        }
    });

    // Arkadaşlık isteğini reddet
    socket.on('reject friend', (requester) => {
        const current = users[socket.id]?.username;
        if (!current) return;
        const pending = userData[current]?.pendingRequests;
        if (!pending) return;
        const index = pending.indexOf(requester);
        if (index !== -1) {
            pending.splice(index, 1);
            socket.emit('user data', userData[current]);
        }
    });

    // Özel mesaj gönderme
    socket.on('private message', (data) => {
        const { to, from, content, timestamp } = data;
        const receiver = Object.values(users).find(u => u.username === to);
        if (receiver) {
            receiver.socket.emit('private message', { from, content, timestamp });
        }
    });

    // Bağlantı kopma
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            delete users[socket.id];
            broadcastUserList();
            io.emit('user disconnected', user.username);
        }
    });

    function broadcastUserList() {
        const userList = Object.keys(userData);
        io.emit('user list', userList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});