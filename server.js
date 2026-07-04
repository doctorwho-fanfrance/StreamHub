const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Stockage en mémoire de l'état des salons
// Structure : roomsData[roomId] = { playlist: [], users: { socketId: username } }
const roomsData = {};

io.on('connection', (socket) => {
    console.log(`[Connecté] Un utilisateur s'est connecté : ${socket.id}`);

    // Rejoindre un salon
    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        
        // Nettoyage du pseudo
        const user = username ? username.trim() : 'Anonyme';
        socket.username = user;

        // Initialiser les données du salon si inexistant
        if (!roomsData[roomId]) {
            roomsData[roomId] = {
                playlist: [],
                users: {}
            };
        }

        // Ajouter l'utilisateur
        roomsData[roomId].users[socket.id] = user;

        console.log(`[Salon ${roomId}] ${user} a rejoint.`);

        // 1. Envoyer la liste mise à jour de tous les utilisateurs du salon
        io.to(roomId).emit('update-users', Object.values(roomsData[roomId].users));

        // 2. Lui envoyer l'état actuel de la playlist du salon
        socket.emit('update-playlist', roomsData[roomId].playlist);

        // 3. Notifier le chat du salon
        io.to(roomId).emit('chat-message', {
            username: 'Système',
            message: `${user} a rejoint le salon.`,
            isSystem: true
        });
    });

    // Gestion du Chat
    socket.on('send-chat-message', ({ message }) => {
        const roomId = socket.roomId;
        if (roomId && message && message.trim() !== '') {
            io.to(roomId).emit('chat-message', {
                username: socket.username || 'Anonyme',
                message: message.trim(),
                isSystem: false
            });
        }
    });

    // Contrôle Vidéo (Play/Pause/Seek)
    socket.on('video-action', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-video-action', data);
        }
    });

    // Changement immédiat de vidéo
    socket.on('change-video', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user-changed-video', data);
        }
    });

    // Gestion de la Playlist (Ajout à la file)
    socket.on('add-to-playlist', ({ videoUrl }) => {
        const roomId = socket.roomId;
        if (roomId && videoUrl) {
            // Extraction rapide d'un titre lisible
            let title = "Vidéo externe";
            if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
                title = "Vidéo YouTube";
            } else {
                title = videoUrl.split('/').pop().split('?')[0] || "Lien Vidéo";
            }

            const newItem = { id: Math.random().toString(36).substring(2, 7), url: videoUrl, title };
            roomsData[roomId].playlist.push(newItem);

            io.to(roomId).emit('update-playlist', roomsData[roomId].playlist);
            
            io.to(roomId).emit('chat-message', {
                username: 'Système',
                message: `Une vidéo a été ajoutée à la file d'attente.`,
                isSystem: true
            });
        }
    });

    // Retirer ou passer à la vidéo suivante dans la playlist
    socket.on('remove-from-playlist', ({ itemId }) => {
        const roomId = socket.roomId;
        if (roomId && roomsData[roomId]) {
            roomsData[roomId].playlist = roomsData[roomId].playlist.filter(item => item.id !== itemId);
            io.to(roomId).emit('update-playlist', roomsData[roomId].playlist);
        }
    });

    // Déconnexion
    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && roomsData[roomId]) {
            const userLeaving = roomsData[roomId].users[socket.id];
            delete roomsData[roomId].users[socket.id];

            // Mettre à jour les clients restants
            io.to(roomId).emit('update-users', Object.values(roomsData[roomId].users));

            if (userLeaving) {
                io.to(roomId).emit('chat-message', {
                    username: 'Système',
                    message: `${userLeaving} a quitté le salon.`,
                    isSystem: true
                });
            }

            // Nettoyer la mémoire si le salon est totalement vide
            if (Object.keys(roomsData[roomId].users).length === 0) {
                delete roomsData[roomId];
                console.log(`[Salon ${roomId}] Salon vide supprimé de la mémoire.`);
            }
        }
        console.log(`[Déconnecté] L'utilisateur a quitté : ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(` Serveur StreamHub actif sur le port ${PORT}`);
});