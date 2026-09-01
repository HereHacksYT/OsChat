const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Aktif kullanıcılar: socketId -> { username, socket }
const users = {};

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    // Kullanıcı adı belirleme
    socket.on('set username', (username) => {
        users[socket.id] = { username, socket };
        broadcastUserList();
        io.emit('user connected', username);
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

    // Kullanıcı listesini yayınla
    function broadcastUserList() {
        const userList = Object.values(users).map(u => u.username);
        io.emit('user list', userList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
