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

// Service des fichiers statiques (html, css, js)
app.use(express.static(path.join(__dirname, 'public')));

// Couleurs attribuées aléatoirement aux utilisateurs pour le chat & les pseudos
const USER_COLORS = [
    '#ff007f', '#00f2fe', '#4facfe', '#00ff87', 
    '#ffd700', '#ffa500', '#a044ff', '#ff4e50'
];

// Stockage en mémoire des données des salons
// Structure : { [roomId]: { users: [], playlist: [], tttState: {}, c4State: {} } }
const rooms = {};

// Helper pour réinitialiser le Morpion
function getInitialTTTState() {
    return {
        board: Array(9).fill(''),
        turn: 'X'
    };
}

// Helper pour réinitialiser le Puissance 4 (6 lignes x 7 colonnes)
function getInitialC4State() {
    return {
        board: Array(6).fill(null).map(() => Array(7).fill(0)),
        turn: 1 // 1 = Joueur 1 (Rouge), 2 = Joueur 2 (Jaune)
    };
}

io.on('connection', (socket) => {
    console.log(`[+] Nouveau client connecté : ${socket.id}`);

    // --- REJOINDRE UN SALON ---
    socket.on('join-room', ({ roomId, username }) => {
        socket.roomId = roomId;
        socket.username = username || 'Anonyme';
        socket.userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

        socket.join(roomId);

        // Création du salon en mémoire s'il n'existe pas encore
        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],
                playlist: [],
                tttState: getInitialTTTState(),
                c4State: getInitialC4State()
            };
        }

        const room = rooms[roomId];

        // Ajout de l'utilisateur à la liste du salon
        room.users.push({
            id: socket.id,
            username: socket.username,
            color: socket.userColor
        });

        // Notification d'arrivée dans le chat
        io.to(roomId).emit('chat-message', {
            username: 'Système',
            message: `${socket.username} a rejoint le salon ! 🎉`,
            color: '#00f2fe',
            isSystem: true
        });

        // Mise à jour de la liste des membres pour tout le monde
        io.to(roomId).emit('update-users', room.users);

        // Envoyer l'état actuel de la playlist et des jeux au nouvel arrivant
        socket.emit('update-playlist', room.playlist);
        socket.emit('ttt-update', room.tttState);
        socket.emit('c4-update', room.c4State);

        // Si ce n'est pas le premier utilisateur, on demande l'heure actuelle de la vidéo à un ancien
        if (room.users.length > 1) {
            const firstUser = room.users[0].id;
            io.to(firstUser).emit('get-current-time-for-sync', { requesterId: socket.id });
        }
    });

    // --- SYNCHRONISATION LECTEUR VIDÉO ---
    socket.on('change-video', (videoData) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('user-changed-video', videoData);
    });

    socket.on('video-action', ({ action, currentTime }) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('user-video-action', { action, currentTime });
    });

    socket.on('request-sync-force', () => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const roomUsers = rooms[socket.roomId].users;
        if (roomUsers.length > 1) {
            const hostId = roomUsers[0].id;
            io.to(hostId).emit('get-current-time-for-sync', { requesterId: socket.id });
        }
    });

    socket.on('respond-time-for-sync', ({ requesterId, currentTime, action }) => {
        io.to(requesterId).emit('user-video-action', { action, currentTime });
    });

    // --- LOGIQUE MULTIJOUEUR WEBRTC (VISIO / VOCAL) ---
    socket.on('request-peers-trigger', () => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('user-joined-webrtc', {
            id: socket.id,
            username: socket.username
        });
    });

    socket.on('video-offer', ({ sdp, to }) => {
        io.to(to).emit('video-offer', { sdp, from: socket.id });
    });

    socket.on('video-answer', ({ sdp, to }) => {
        io.to(to).emit('video-answer', { sdp, from: socket.id });
    });

    socket.on('new-ice-candidate', ({ candidate, to }) => {
        io.to(to).emit('new-ice-candidate', { candidate, from: socket.id });
    });

    socket.on('audio-speaking', ({ isSpeaking }) => {
        if (!socket.roomId) return;
        socket.to(socket.roomId).emit('user-audio-speaking', { id: socket.id, isSpeaking });
    });

    // --- CHAT EN DIRECT ---
    socket.on('send-chat-message', ({ message }) => {
        if (!socket.roomId) return;
        io.to(socket.roomId).emit('chat-message', {
            username: socket.username,
            message: message,
            color: socket.userColor,
            isSystem: false
        });
    });

    // --- FILE D'ATTENTE / PLAYLIST ---
    socket.on('add-to-playlist', ({ videoUrl }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const room = rooms[socket.roomId];

        const newItem = {
            id: 'item-' + Math.random().toString(36).substring(2, 9),
            url: videoUrl,
            title: videoUrl.length > 35 ? videoUrl.substring(0, 35) + '...' : videoUrl
        };

        room.playlist.push(newItem);
        io.to(socket.roomId).emit('update-playlist', room.playlist);
    });

    socket.on('remove-from-playlist', ({ itemId }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const room = rooms[socket.roomId];
        room.playlist = room.playlist.filter(item => item.id !== itemId);
        io.to(socket.roomId).emit('update-playlist', room.playlist);
    });

    // --- MINI-JEU 1 : MORPION (Tic-Tac-Toe) ---
    socket.on('ttt-move', ({ idx, symbol }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const state = rooms[socket.roomId].tttState;

        state.board[idx] = symbol;
        state.turn = symbol === 'X' ? 'O' : 'X';

        io.to(socket.roomId).emit('ttt-update', state);
    });

    socket.on('ttt-reset', () => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        rooms[socket.roomId].tttState = getInitialTTTState();
        io.to(socket.roomId).emit('ttt-update', rooms[socket.roomId].tttState);
    });

    // --- MINI-JEU 2 : PUISSANCE 4 ---
    socket.on('c4-move', ({ col, player }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const state = rooms[socket.roomId].c4State;

        // Fait tomber le jeton dans la plus basse case disponible de la colonne
        for (let r = 5; r >= 0; r--) {
            if (state.board[r][col] === 0) {
                state.board[r][col] = player;
                state.turn = player === 1 ? 2 : 1;
                break;
            }
        }

        io.to(socket.roomId).emit('c4-update', state);
    });

    socket.on('c4-reset', () => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        rooms[socket.roomId].c4State = getInitialC4State();
        io.to(socket.roomId).emit('c4-update', rooms[socket.roomId].c4State);
    });

    // --- DÉCONNEXION ---
    socket.on('disconnect', () => {
        console.log(`[-] Client déconnecté : ${socket.id}`);
        const roomId = socket.roomId;

        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];

            // Retirer l'utilisateur de la liste
            room.users = room.users.filter(u => u.id !== socket.id);

            // Informer les pairs WebRTC
            socket.to(roomId).emit('user-left-webrtc', { id: socket.id });

            if (room.users.length > 0) {
                // Notifier le départ dans le chat
                io.to(roomId).emit('chat-message', {
                    username: 'Système',
                    message: `${socket.username} a quitté le salon.`,
                    color: '#ff4e50',
                    isSystem: true
                });

                // Mettre à jour la liste des membres
                io.to(roomId).emit('update-users', room.users);
            } else {
                // Supprimer le salon de la mémoire si plus personne n'est présent
                delete rooms[roomId];
            }
        }
    });
});

// Lancement du serveur sur le port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`🚀 Serveur StreamHub lancé sur le port ${PORT}`);
    console.log(`🔗 Accès local : http://localhost:${PORT}`);
    console.log(`=============================================`);
});