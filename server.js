const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const roomsData = {};
const CHAT_COLORS = ['#ff007f', '#00f2fe', '#4facfe', '#00ff87', '#f9d423', '#ff4e50', '#e100ff', '#00ffcc'];

// Pour stocker les timers des utilisateurs qui actualisent la page
const disconnectTimeouts = {};

io.on('connection', (socket) => {
    console.log(`[Connecté] : ${socket.id}`);

    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        const user = username ? username.trim() : 'Anonyme';
        socket.username = user;

        if (!roomsData[roomId]) {
            roomsData[roomId] = { playlist: [], users: {}, currentVideo: null };
        }

        // --- GESTION DU RECHARGEMENT (ANTI-SPAM CHAT) ---
        // On cherche si cet utilisateur était déjà là récemment (même pseudo dans la même room)
        const alreadyExisted = Object.values(roomsData[roomId].users).find(u => u.username === user);
        
        if (alreadyExisted) {
            // S'il y a un timer de déconnexion en cours pour ce pseudo, on l'annule !
            if (disconnectTimeouts[alreadyExisted.id]) {
                clearTimeout(disconnectTimeouts[alreadyExisted.id]);
                delete disconnectTimeouts[alreadyExisted.id];
            }
            // On récupère sa couleur d'origine pour garder une cohérence graphique
            socket.userColor = alreadyExisted.color;
            // On supprime l'ancienne entrée temporaire pour mettre la nouvelle à jour
            delete roomsData[roomId].users[alreadyExisted.id];
        } else {
            // Nouvel utilisateur classique
            socket.userColor = CHAT_COLORS[Math.floor(Math.random() * CHAT_COLORS.length)];
        }

        roomsData[roomId].users[socket.id] = {
            id: socket.id,
            username: user,
            color: socket.userColor
        };

        if (roomsData[roomId].currentVideo) {
            socket.emit('user-changed-video', roomsData[roomId].currentVideo);
        }

        socket.to(roomId).emit('user-joined-webrtc', { id: socket.id, username: user });
        io.to(roomId).emit('update-users', Object.values(roomsData[roomId].users));
        socket.emit('update-playlist', roomsData[roomId].playlist);
        
        // On n'envoie le message de bienvenue que si ce n'est pas un simple rafraîchissement de page
        if (!alreadyExisted) {
            io.to(roomId).emit('chat-message', {
                username: 'Système',
                message: `${user} a rejoint le salon.`,
                color: '#9ca3af',
                isSystem: true
            });
        }
    });

    socket.on('audio-speaking', ({ isSpeaking }) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-audio-speaking', { id: socket.id, isSpeaking });
        }
    });

    socket.on('request-sync-force', () => {
        const roomId = socket.roomId;
        if (roomId && roomsData[roomId]) {
            const users = Object.keys(roomsData[roomId].users);
            if (users.length > 1) {
                const masterUser = users[0] === socket.id ? users[1] : users[0];
                io.to(masterUser).emit('get-current-time-for-sync', { requesterId: socket.id });
            }
        }
    });

    socket.on('respond-time-for-sync', ({ requesterId, currentTime, action }) => {
        io.to(requesterId).emit('user-video-action', { action, currentTime });
    });

    socket.on('request-peers-trigger', () => {
        const roomId = socket.roomId;
        if (roomId) {
            socket.to(roomId).emit('user-joined-webrtc', { id: socket.id, username: socket.username });
        }
    });

    socket.on('video-offer', ({ sdp, to }) => {
        socket.to(to).emit('video-offer', { sdp, from: socket.id });
    });

    socket.on('video-answer', ({ sdp, to }) => {
        socket.to(to).emit('video-answer', { sdp, from: socket.id });
    });

    socket.on('new-ice-candidate', ({ candidate, to }) => {
        socket.to(to).emit('new-ice-candidate', { candidate, from: socket.id });
    });

    socket.on('send-chat-message', ({ message }) => {
        const roomId = socket.roomId;
        if (roomId && message?.trim()) {
            io.to(roomId).emit('chat-message', {
                username: socket.username,
                message: message.trim(),
                color: socket.userColor,
                isSystem: false
            });
        }
    });

    socket.on('video-action', (data) => {
        if (socket.roomId) socket.to(socket.roomId).emit('user-video-action', data);
    });

    socket.on('change-video', (data) => {
        const roomId = socket.roomId;
        if (roomId && roomsData[roomId]) {
            roomsData[roomId].currentVideo = data;
            socket.to(roomId).emit('user-changed-video', data);
        }
    });

    socket.on('add-to-playlist', ({ videoUrl }) => {
        const roomId = socket.roomId;
        if (roomId && videoUrl) {
            let title = "Lien Vidéo";
            if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) title = "Vidéo YouTube";
            else if (videoUrl.includes('twitch.tv')) title = "Stream Twitch";
            else title = videoUrl.split('/').pop().split('?')[0] || "Fichier MP4";

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
        const socketId = socket.id;

        if (roomId && roomsData[roomId]) {
            const userData = roomsData[roomId].users[socketId];

            if (userData) {
                // On met l'utilisateur en "sursis" pendant 2.5 secondes avant de l'effacer définitivement
                disconnectTimeouts[socketId] = setTimeout(() => {
                    if (roomsData[roomId] && roomsData[roomId].users[socketId]) {
                        delete roomsData[roomId].users[socketId];
                        
                        socket.to(roomId).emit('user-left-webrtc', { id: socketId });
                        io.to(roomId).emit('update-users', Object.values(roomsData[roomId].users));

                        io.to(roomId).emit('chat-message', {
                            username: 'Système',
                            message: `${userData.username} a quitté le salon.`,
                            color: '#9ca3af',
                            isSystem: true
                        });

                        if (Object.keys(roomsData[roomId].users).length === 0) delete roomsData[roomId];
                    }
                    delete disconnectTimeouts[socketId];
                }, 2500); // 2.5 secondes laissent largement le temps à un F5 de s'exécuter
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur actif sur le port ${PORT}`));