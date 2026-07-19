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

io.on('connection', (socket) => {
    console.log(`[Connecté] : ${socket.id}`);

    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        const user = username ? username.trim() : 'Anonyme';
        socket.username = user;
        socket.userColor = CHAT_COLORS[Math.floor(Math.random() * CHAT_COLORS.length)];

        if (!roomsData[roomId]) {
            roomsData[roomId] = { playlist: [], users: {}, currentVideo: null };
        }

        roomsData[roomId].users[socket.id] = {
            id: socket.id,
            username: user,
            color: socket.userColor
        };

        // Envoi de la vidéo actuelle au nouvel arrivant (YouTube, Twitch ou MP4)
        if (roomsData[roomId].currentVideo) {
            socket.emit('user-changed-video', roomsData[roomId].currentVideo);
        }

        socket.to(roomId).emit('user-joined-webrtc', { id: socket.id, username: user });
        io.to(roomId).emit('update-users', Object.values(roomsData[roomId].users));
        socket.emit('update-playlist', roomsData[roomId].playlist);
        
        io.to(roomId).emit('chat-message', {
            username: 'Système',
            message: `${user} a rejoint le salon.`,
            color: '#9ca3af',
            isSystem: true
        });
    });

    // --- INDICATEUR DE PAROLE (AUDIO DETECT) ---
    socket.on('audio-speaking', ({ isSpeaking }) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-audio-speaking', { id: socket.id, isSpeaking });
        }
    });

    // --- RE-FORCE SYNC REQUEST ---
    // Quand un utilisateur clique sur "Forcer la synchro", le serveur demande au premier de la salle sa position
    socket.on('request-sync-force', () => {
        const roomId = socket.roomId;
        if (roomId && roomsData[roomId]) {
            const users = Object.keys(roomsData[roomId].users);
            if (users.length > 1) {
                // On demande au premier utilisateur connecté (le "host" implicite) d'envoyer son timestamp actuel
                const masterUser = users[0] === socket.id ? users[1] : users[0];
                io.to(masterUser).emit('get-current-time-for-sync', { requesterId: socket.id });
            }
        }
    });

    socket.on('respond-time-for-sync', ({ requesterId, currentTime, action }) => {
        io.to(requesterId).emit('user-video-action', { action, currentTime });
    });

    // --- SIGNALING WEBRTC ---
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

    // --- ACTIONS DE SALON ---
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
            roomsData[roomId].currentVideo = data; // Stocke tout l'objet { type, url }
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
        if (roomId && roomsData[roomId]) {
            const userData = roomsData[roomId].users[socket.id];
            delete roomsData[roomId].users[socket.id];

            socket.to(roomId).emit('user-left-webrtc', { id: socket.id });
            io.to(roomId).emit('update-users', Object.values(roomsData[roomId].users));

            if (userData) {
                io.to(roomId).emit('chat-message', {
                    username: 'Système',
                    message: `${userData.username} a quitté le salon.`,
                    color: '#9ca3af',
                    isSystem: true
                });
            }

            if (Object.keys(roomsData[roomId].users).length === 0) delete roomsData[roomId];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur actif sur le port ${PORT}`));