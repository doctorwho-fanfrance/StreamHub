const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/videos', express.static(path.join(__dirname, 'videos')));

const rooms = {};

io.on('connection', (socket) => {
    console.log(`Nouvelle connexion : ${socket.id}`);

    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { users: [], currentVideo: null, currentAudio: null, isPlaying: false };
        }
        rooms[roomId].users.push({ id: socket.id, username });

        if (rooms[roomId].currentVideo) {
            socket.emit('sync-video', {
                videoUrl: rooms[roomId].currentVideo,
                isPlaying: rooms[roomId].isPlaying
            });
        }
        if (rooms[roomId].currentAudio) {
            socket.emit('user-changed-audio', { audioUrl: rooms[roomId].currentAudio });
        }
    });

    socket.on('change-video', ({ roomId, videoUrl }) => {
        if (rooms[roomId]) rooms[roomId].currentVideo = videoUrl;
        socket.to(roomId).emit('user-changed-video', { videoUrl });
    });

    // --- PRISE EN CHARGE DE LA MUSIQUE ---
    socket.on('change-audio', ({ roomId, audioUrl }) => {
        if (rooms[roomId]) rooms[roomId].currentAudio = audioUrl;
        socket.to(roomId).emit('user-changed-audio', { audioUrl });
    });

    socket.on('video-action', ({ roomId, action, currentTime }) => {
        if (rooms[roomId]) {
            rooms[roomId].isPlaying = (action === 'play' || action === 'audio-play');
        }
        socket.to(roomId).emit('user-video-action', { action, currentTime });
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            rooms[roomId].users = rooms[roomId].users.filter(user => user.id !== socket.id);
            if (rooms[roomId].users.length === 0) {
                delete rooms[roomId];
            }
        }
    });
});

http.listen(PORT, () => {
    console.log(`Serveur en ligne sur le port ${PORT}`);
});