const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Servir les fichiers statiques (index.html, CSS, JS frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Rediriger toutes les routes vers index.html pour charger l'interface
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Stockage en mémoire de l'état des salons
const rooms = {};

io.on('connection', (socket) => {
    console.log(`🔌 Nouveau client connecté : ${socket.id}`);

    // --- REJOINDRE OU CRÉER UN SALON ---
    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.username = username || 'Anonyme';

        // Initialiser les données du salon si c'est la création
        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],
                currentVideo: null,
                videoState: { currentTime: 0, isPlaying: false }
            };
        }

        // Ajouter l'utilisateur à la liste du salon
        const userObj = { id: socket.id, username: socket.username };
        rooms[roomId].users.push(userObj);

        // Notifier les membres du salon
        io.to(roomId).emit('room-users', rooms[roomId].users);
        socket.to(roomId).emit('chat-message', {
            user: 'Système',
            message: `👋 <strong>${socket.username}</strong> a rejoint le salon !`,
            isSystem: true
        });

        // Envoyer la vidéo en cours si elle existe
        if (rooms[roomId].currentVideo) {
            socket.emit('change-video', rooms[roomId].currentVideo);
        }

        console.log(`👤 ${socket.username} (${socket.id}) a rejoint ${roomId}`);
    });

    // --- SYNCHRONISATION VIDÉO ---
    socket.on('change-video', (videoData) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            rooms[roomId].currentVideo = videoData;
            socket.to(roomId).emit('change-video', videoData);
        }
    });

    socket.on('sync-video', (stateData) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            rooms[roomId].videoState = stateData;
            socket.to(roomId).emit('sync-video', stateData);
        }
    });

    // --- GESTION DES MINI-JEUX (MORPION & PUISSANCE 4) ---
    socket.on('game-move', (data) => {
        const roomId = data.room || socket.roomId;
        if (roomId) {
            // Relayer le coup à TOUS les joueurs du salon
            io.to(roomId).emit('game-move', data);
        }
    });

    socket.on('game-reset', (data) => {
        const roomId = data.room || socket.roomId;
        if (roomId) {
            // Recommencer la partie pour tout le monde
            io.to(roomId).emit('game-reset', data);
        }
    });

    // --- GESTION DU CHAT ---
    socket.on('chat-message', (message) => {
        const roomId = socket.roomId;
        if (roomId) {
            io.to(roomId).emit('chat-message', {
                user: socket.username,
                message: message,
                isSystem: false
            });
        }
    });

    // --- WEBRTC & SIGNALISATION VISIO ---
    socket.on('audio-speaking', (data) => {
        const roomId = socket.roomId;
        if (roomId) {
            socket.to(roomId).emit('peer-speaking', { id: socket.id, isSpeaking: data.isSpeaking });
        }
    });

    socket.on('request-peers-trigger', () => {
        const roomId = socket.roomId;
        if (roomId) {
            socket.to(roomId).emit('user-joined-webrtc', { peerId: socket.id, username: socket.username });
        }
    });

    socket.on('webrtc-offer', (data) => {
        io.to(data.target).emit('webrtc-offer', {
            sdp: data.sdp,
            callerId: socket.id,
            username: socket.username
        });
    });

    socket.on('webrtc-answer', (data) => {
        io.to(data.target).emit('webrtc-answer', {
            sdp: data.sdp,
            responderId: socket.id
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        io.to(data.target).emit('webrtc-ice-candidate', {
            candidate: data.candidate,
            senderId: socket.id
        });
    });

    // --- DÉCONNEXION ---
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            // Retirer l'utilisateur de la mémoire
            rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== socket.id);
            
            // Informer les autres membres
            io.to(roomId).emit('room-users', rooms[roomId].users);
            io.to(roomId).emit('user-disconnected-webrtc', { peerId: socket.id });
            socket.to(roomId).emit('chat-message', {
                user: 'Système',
                message: `🚪 <strong>${socket.username}</strong> a quitté le salon.`,
                isSystem: true
            });

            // Nettoyer la room si elle est vide
            if (rooms[roomId].users.length === 0) {
                delete rooms[roomId];
            }
        }
        console.log(`❌ Client déconnecté : ${socket.id}`);
    });
});

// Lancement du serveur sur le port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
🚀 Serveur StreamHub démarré avec succès !
📡 URL locale : http://localhost:${PORT}
🎮 Modules actifs : Synchro Vidéo, Chat, Visio WebRTC, Morpion, Puissance 4
    `);
});