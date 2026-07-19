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

        // On stocke l'ID du socket pour la logique de salon et WebRTC
        roomsData[roomId].users[socket.id] = {
            id: socket.id,
            username: user,
            color: socket.userColor
        };

        // Si une vidéo est déjà diffusée dans le salon, on l'envoie au nouvel arrivant
        if (roomsData[roomId].currentVideo) {
            socket.emit('user-changed-video', { videoUrl: roomsData[roomId].currentVideo });
        }

        // Informer les anciens qu'un nouveau est là pour tenter d'initier le WebRTC
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

    // --- LOGIQUE SIGNALING WEBRTC (LES INTERNES DE L'APPEL) ---
    
    // Écouteur manquant : Déclenché quand quelqu'un active sa caméra après être entré dans le salon
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
    // ---------------------------------------------------------

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
            // On sauvegarde l'URL pour les prochains arrivants
            roomsData[roomId].currentVideo = data.videoUrl;
            socket.to(roomId).emit('user-changed-video', data);
        }
    });

    socket.on('add-to-playlist', ({ videoUrl }) => {
        const roomId = socket.roomId;
        if (roomId && videoUrl) {
            let title = videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be') ? "Vidéo YouTube" : (videoUrl.split('/').pop().split('?')[0] || "Lien Vidéo");
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

            // Informer les autres de couper le flux de ce peer
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