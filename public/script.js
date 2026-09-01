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

// ---------- Uygulama durumu ----------
let currentUser = null;
let socket = null;
let currentFriend = null;
let onlineUsers = [];
let myFriends = [];
let pendingRequests = [];

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
const requestsListEl = document.getElementById('requests-list');
const backBtn = document.getElementById('back-to-friends');

// IndexedDB'yi aç
openDB().catch(err => console.error('IndexedDB hatası:', err));

// ---------- Oturum kontrolü ----------
const savedUsername = localStorage.getItem('oschat_username');
if (savedUsername) {
    // Otomatik giriş yap
    usernameInput.value = savedUsername;
    login();
}

loginBtn.addEventListener('click', login);

function login() {
    const username = usernameInput.value.trim();
    if (!username) {
        alert('Lütfen bir kullanıcı adı girin.');
        return;
    }
    currentUser = username;
    localStorage.setItem('oschat_username', username);
    loginScreen.style.display = 'none';
    app.style.display = 'flex';
    myUsernameSpan.textContent = username;

    socket = io();
    socket.on('connect', () => {
        socket.emit('set username', currentUser);
    });

    socket.on('user data', (data) => {
        myFriends = data.friends || [];
        pendingRequests = data.pendingRequests || [];
        renderFriendList();
        renderRequests();
    });

    socket.on('user list', (users) => {
        onlineUsers = users.filter(u => u !== currentUser);
        renderFriendList();
    });

    socket.on('new friend request', (from) => {
        pendingRequests.push(from);
        renderRequests();
    });

    socket.on('friend request accepted', (by) => {
        // Karşılıklı arkadaş eklendi, zaten user data ile güncellenecek
        alert(`${by} arkadaşlık isteğini kabul etti!`);
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

    socket.on('error', (msg) => {
        alert(msg);
    });

    renderFriendList();
    renderRequests();

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    logoutBtn.addEventListener('click', () => {
        if (socket) socket.disconnect();
        localStorage.removeItem('oschat_username');
        currentUser = null;
        app.style.display = 'none';
        loginScreen.style.display = 'block';
        usernameInput.value = '';
        friendListEl.innerHTML = '';
        messagesEl.innerHTML = '';
        requestsListEl.innerHTML = '';
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
        // Sunucuya istek gönder
        socket.emit('friend request', friend);
        searchInput.value = '';
    });

    // Mobilde geri butonu
    backBtn.addEventListener('click', () => {
        // sidebar'ı göster, chat'i gizle gibi bir işlem yapabiliriz, 
        // ama responsive yapıda ikisi de görünüyor. Daha iyisi, mobilde arkadaş seçince sidebar'ı gizleyip chat'i tam ekran yapalım.
        // Bunu aşağıda friend item tıklamasında yapacağız.
    });
}

// ---------- Arkadaş listesini render et ----------
function renderFriendList() {
    friendListEl.innerHTML = '';
    if (myFriends.length === 0) {
        friendListEl.innerHTML = '<p style="padding:10px;color:gray;">Henüz arkadaşınız yok.</p>';
        return;
    }
    myFriends.forEach(friend => {
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
            // Mobilde chat'e odaklan
            if (window.innerWidth <= 768) {
                // Sidebar'ı gizle, chat'i tam ekran yap
                document.getElementById('sidebar').style.display = 'none';
                document.getElementById('chat-area').style.height = '100vh';
                backBtn.style.display = 'block';
            }
        });
        friendListEl.appendChild(div);
    });
}

// ---------- İstekleri render et ----------
function renderRequests() {
    requestsListEl.innerHTML = '';
    if (pendingRequests.length === 0) {
        requestsListEl.innerHTML = '<span style="color:gray; font-size:0.8rem;">İstek yok</span>';
        return;
    }
    pendingRequests.forEach(requester => {
        const div = document.createElement('div');
        div.className = 'request-item';
        div.innerHTML = `
            <span>${requester}</span>
            <div>
                <button class="accept" data-user="${requester}">Kabul</button>
                <button class="reject" data-user="${requester}">Red</button>
            </div>
        `;
        div.querySelector('.accept').addEventListener('click', () => {
            socket.emit('accept friend', requester);
        });
        div.querySelector('.reject').addEventListener('click', () => {
            socket.emit('reject friend', requester);
        });
        requestsListEl.appendChild(div);
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

// ---------- Mobilde geri butonu ile sidebar'ı geri getir ----------
backBtn.addEventListener('click', () => {
    document.getElementById('sidebar').style.display = 'flex';
    document.getElementById('chat-area').style.height = '50vh';
    backBtn.style.display = 'none';
});

// Sayfa yenilendiğinde sidebar görünür olsun
window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
        document.getElementById('sidebar').style.display = 'flex';
        document.getElementById('chat-area').style.height = '100vh';
        backBtn.style.display = 'none';
    }
});