const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Stockage en mémoire de l'état des salons
const roomsData = {};

// Liste de couleurs sympas et bien visibles sur fond sombre
const CHAT_COLORS = [
    '#ff007f', '#00f2fe', '#4facfe', '#00ff87', 
    '#f9d423', '#ff4e50', '#e100ff', '#00ffcc',
    '#ff9900', '#ff5e62', '#38ef7d', '#b3ebe6'
];

io.on('connection', (socket) => {
    console.log(`[Connecté] Un utilisateur s'est connecté : ${socket.id}`);

    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        
        const user = username ? username.trim() : 'Anonyme';
        socket.username = user;

        // Choix d'une couleur aléatoire pour cet utilisateur
        socket.userColor = CHAT_COLORS[Math.floor(Math.random() * CHAT_COLORS.length)];

        if (!roomsData[roomId]) {
            roomsData[roomId] = {
                playlist: [],
                users: {} // socketId: { username, color }
            };
        }

        roomsData[roomId].users[socket.id] = {
            username: user,
            color: socket.userColor
        };

        console.log(`[Salon ${roomId}] ${user} a rejoint.`);

        // Envoyer la liste mise à jour des utilisateurs (avec leurs couleurs)
        io.to(roomId).emit('update-users', Object.values(roomsData[roomId].users));

        // Envoyer la playlist actuelle
        socket.emit('update-playlist', roomsData[roomId].playlist);

        // Message système
        io.to(roomId).emit('chat-message', {
            username: 'Système',
            message: `${user} a rejoint le salon.`,
            color: '#9ca3af',
            isSystem: true
        });
    });

    // Envoi de message avec couleur persistante
    socket.on('send-chat-message', ({ message }) => {
        const roomId = socket.roomId;
        if (roomId && message && message.trim() !== '') {
            io.to(roomId).emit('chat-message', {
                username: socket.username || 'Anonyme',
                message: message.trim(),
                color: socket.userColor || '#ffffff',
                isSystem: false
            });
        }
    });

    socket.on('video-action', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-video-action', data);
        }
    });

    socket.on('change-video', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-changed-video', data);
        }
    });

    socket.on('add-to-playlist', ({ videoUrl }) => {
        const roomId = socket.roomId;
        if (roomId && videoUrl) {
            let title = "Vidéo externe";
            if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
                title = "Vidéo YouTube";
            } else {
                title = videoUrl.split('/').pop().split('?')[0] || "Lien Vidéo";
            }

            const newItem = { id: Math.random().toString(36).substring(2, 7), url: videoUrl, title };
            roomsData[roomId].playlist.push(newItem);

            io.to(roomId).emit('update-playlist', roomsData[roomId].playlist);
        }
    });

    socket.on('remove-from-playlist', ({ itemId }) => {
        const roomId = socket.roomId;
        if (roomId && roomsData[roomId]) {
            roomsData[roomId].playlist = roomsData[roomId].playlist.filter(item => item.id !== itemId);
            io.to(roomId).emit('update-playlist', roomsData[roomId].playlist);
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && roomsData[roomId]) {
            const userData = roomsData[roomId].users[socket.id];
            delete roomsData[roomId].users[socket.id];

            io.to(roomId).emit('update-users', Object.values(roomsData[roomId].users));

            if (userData) {
                io.to(roomId).emit('chat-message', {
                    username: 'Système',
                    message: `${userData.username} a quitté le salon.`,
                    color: '#9ca3af',
                    isSystem: true
                });
            }

            if (Object.keys(roomsData[roomId].users).length === 0) {
                delete roomsData[roomId];
                console.log(`[Salon ${roomId}] Salon vide supprimé.`);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(` Serveur StreamHub actif sur le port ${PORT}`);
});