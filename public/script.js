// ---------- IndexedDB ----------
const DB_NAME = 'OsChatDB';
const STORE_NAME = 'messages';
let db;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

function saveMessage(message) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.add(message);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function getMessages(user1, user2) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_NAME], 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
            const all = req.result;
            const filtered = all.filter(msg =>
                (msg.from === user1 && msg.to === user2) ||
                (msg.from === user2 && msg.to === user1)
            );
            resolve(filtered);
        };
        req.onerror = () => reject(req.error);
    });
}

// ---------- LocalStorage (arkadaş listesi) ----------
function getFriends() {
    const data = localStorage.getItem('friends');
    return data ? JSON.parse(data) : [];
}

function saveFriends(friends) {
    localStorage.setItem('friends', JSON.stringify(friends));
}

function addFriend(username) {
    const friends = getFriends();
    if (!friends.includes(username) && username !== currentUser) {
        friends.push(username);
        saveFriends(friends);
        return true;
    }
    return false;
}

// ---------- Uygulama durumu ----------
let currentUser = null;
let socket = null;
let currentFriend = null;
let onlineUsers = [];

// DOM referansları
const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const usernameInput = document.getElementById('username-input');
const loginBtn = document.getElementById('login-btn');
const myUsernameSpan = document.getElementById('my-username');
const logoutBtn = document.getElementById('logout-btn');
const friendListEl = document.getElementById('friend-list');
const searchInput = document.getElementById('search-input');
const addFriendBtn = document.getElementById('add-friend-btn');
const chatFriendName = document.getElementById('chat-friend-name');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

// IndexedDB'yi aç
openDB().catch(err => console.error('IndexedDB hatası:', err));

// ---------- Giriş ----------
loginBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
        alert('Lütfen bir kullanıcı adı girin.');
        return;
    }
    currentUser = username;
    loginScreen.style.display = 'none';
    app.style.display = 'flex';
    myUsernameSpan.textContent = username;

    socket = io();
    socket.on('connect', () => {
        socket.emit('set username', currentUser);
    });

    socket.on('user list', (users) => {
        onlineUsers = users.filter(u => u !== currentUser);
        renderFriendList();
    });

    socket.on('private message', (data) => {
        const { from, content, timestamp } = data;
        const msg = { from, to: currentUser, content, timestamp };
        saveMessage(msg).then(() => {
            if (currentFriend === from) {
                displayMessage(msg, false);
            }
        });
    });

    socket.on('user connected', (username) => {
        // onlineUsers listesi zaten user list ile güncellenir
    });

    socket.on('user disconnected', (username) => {
        // aynı şekilde
    });

    renderFriendList();

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    logoutBtn.addEventListener('click', () => {
        if (socket) socket.disconnect();
        currentUser = null;
        app.style.display = 'none';
        loginScreen.style.display = 'block';
        usernameInput.value = '';
        friendListEl.innerHTML = '';
        messagesEl.innerHTML = '';
        currentFriend = null;
        chatFriendName.textContent = 'Bir arkadaş seçin';
    });

    addFriendBtn.addEventListener('click', () => {
        const friend = searchInput.value.trim();
        if (!friend) return;
        if (friend === currentUser) {
            alert('Kendinizi ekleyemezsiniz.');
            return;
        }
        if (onlineUsers.includes(friend)) {
            if (addFriend(friend)) {
                renderFriendList();
                searchInput.value = '';
            } else {
                alert('Bu arkadaş zaten ekli.');
            }
        } else {
            alert('Bu kullanıcı çevrimiçi değil veya mevcut değil.');
        }
    });
});

// ---------- Arkadaş listesini render et ----------
function renderFriendList() {
    const friends = getFriends();
    friendListEl.innerHTML = '';
    if (friends.length === 0) {
        friendListEl.innerHTML = '<p style="padding:10px;color:gray;">Henüz arkadaş eklemediniz.</p>';
        return;
    }
    friends.forEach(friend => {
        const div = document.createElement('div');
        div.className = 'friend-item';
        if (currentFriend === friend) div.classList.add('active');
        const isOnline = onlineUsers.includes(friend);
        div.innerHTML = `
            <span class="friend-name">${friend}</span>
            <span class="friend-status ${isOnline ? 'online' : 'offline'}">${isOnline ? '● Çevrimiçi' : '○ Çevrimdışı'}</span>
        `;
        div.addEventListener('click', () => {
            currentFriend = friend;
            chatFriendName.textContent = friend;
            loadMessages(friend);
            renderFriendList();
        });
        friendListEl.appendChild(div);
    });
}

// ---------- Mesajları yükle ----------
async function loadMessages(friend) {
    messagesEl.innerHTML = '';
    if (!friend) return;
    const messages = await getMessages(currentUser, friend);
    messages.sort((a, b) => a.timestamp - b.timestamp);
    messages.forEach(msg => {
        const isSent = msg.from === currentUser;
        displayMessage(msg, isSent);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- Mesajı ekrana ekle ----------
function displayMessage(msg, isSent) {
    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : ''}`;
    const time = new Date(msg.timestamp).toLocaleTimeString();
    div.innerHTML = `
        <div>${msg.content}</div>
        <div class="timestamp">${time}</div>
    `;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- Mesaj gönderme ----------
function sendMessage() {
    if (!currentFriend) {
        alert('Lütfen bir arkadaş seçin.');
        return;
    }
    const content = messageInput.value.trim();
    if (!content) return;
    const timestamp = Date.now();
    const data = { from: currentUser, to: currentFriend, content, timestamp };
    socket.emit('private message', data);
    saveMessage(data).then(() => {
        displayMessage(data, true);
    });
    messageInput.value = '';
}
