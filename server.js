const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Port dynamique pour Render ou 3000 en local
const PORT = process.env.PORT || 3000;

// Servir les dossiers de l'application
app.use(express.static(path.join(__dirname, 'public')));
app.use('/videos', express.static(path.join(__dirname, 'videos')));

// Stockage des salons actifs en mémoire
const rooms = {};

io.on('connection', (socket) => {
    console.log(`Nouvelle connexion : ${socket.id}`);

    // Action : Rejoindre ou créer un salon
    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        
        // Si le salon n'existe pas encore, on le crée
        if (!rooms[roomId]) {
            rooms[roomId] = { users: [], currentVideo: null, isPlaying: false };
        }
        
        rooms[roomId].users.push({ id: socket.id, username });
        console.log(`${username} a rejoint le salon : ${roomId}`);

        // Si une vidéo est déjà en cours, on synchronise le nouvel arrivant
        if (rooms[roomId].currentVideo) {
            socket.emit('sync-video', {
                videoUrl: rooms[roomId].currentVideo,
                isPlaying: rooms[roomId].isPlaying
            });
        }
    });

    // Action : Quelqu'un change de vidéo
    socket.on('change-video', ({ roomId, videoUrl }) => {
        if (rooms[roomId]) {
            rooms[roomId].currentVideo = videoUrl;
        }
        // Envoi aux autres membres du salon uniquement
        socket.to(roomId).emit('user-changed-video', { videoUrl });
    });

    // Action : Play / Pause / Avance rapide
    socket.on('video-action', ({ roomId, action, currentTime }) => {
        if (rooms[roomId]) {
            rooms[roomId].isPlaying = (action === 'play');
        }
        // Synchronisation des lecteurs des autres membres
        socket.to(roomId).emit('user-video-action', { action, currentTime });
    });

    // Action : Déconnexion
    socket.on('disconnect', () => {
        console.log(`Déconnexion : ${socket.id}`);
        // Nettoyage des salons pour retirer l'utilisateur
        for (const roomId in rooms) {
            rooms[roomId].users = rooms[roomId].users.filter(user => user.id !== socket.id);
            // Si le salon est totalement vide, on le supprime
            if (rooms[roomId].users.length === 0) {
                delete rooms[roomId];
            }
        }
    });
});

http.listen(PORT, () => {
    console.log(`Serveur en ligne sur le port ${PORT}`);
});