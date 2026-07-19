const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

const USER_COLORS = ['#ff007f', '#00f2fe', '#4facfe', '#00ff87', '#ffd700', '#ffa500', '#a044ff', '#ff4e50'];
const rooms = {};

// Helpers pour réinitialiser les jeux
function getInitialTTTState() {
    return {
        board: Array(9).fill(''),
        turn: 'X',
        playerX: null,
        playerO: null,
        winner: null
    };
}

function getInitialC4State() {
    return {
        board: Array(6).fill(null).map(() => Array(7).fill(0)),
        turn: 1, // 1 = Rouge, 2 = Jaune
        player1: null,
        player2: null,
        winner: null
    };
}

// Algorithme de vérification des 4 alignés au Puissance 4
function checkC4Winner(board) {
    // Horizontale
    for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 4; c++) {
            let val = board[r][c];
            if (val !== 0 && val === board[r][c+1] && val === board[r][c+2] && val === board[r][c+3]) return val;
        }
    }
    // Verticale
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 7; c++) {
            let val = board[r][c];
            if (val !== 0 && val === board[r+1][c] && val === board[r+2][c] && val === board[r+3][c]) return val;
        }
    }
    // Diagonale (\)
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
            let val = board[r][c];
            if (val !== 0 && val === board[r+1][c+1] && val === board[r+2][c+2] && val === board[r+3][c+3]) return val;
        }
    }
    // Diagonale (/)
    for (let r = 3; r < 6; r++) {
        for (let c = 0; c < 4; c++) {
            let val = board[r][c];
            if (val !== 0 && val === board[r-1][c+1] && val === board[r-2][c+2] && val === board[r-3][c+3]) return val;
        }
    }
    // Match nul
    let isFull = board.every(row => row.every(cell => cell !== 0));
    if (isFull) return 'Tie';

    return null;
}

// Algorithme de vérification du Morpion
function checkTTTWinner(board) {
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (let w of wins) {
        if (board[w[0]] && board[w[0]] === board[w[1]] && board[w[0]] === board[w[2]]) return board[w[0]];
    }
    if (!board.includes('')) return 'Tie';
    return null;
}

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, username }) => {
        socket.roomId = roomId;
        socket.username = username || 'Anonyme';
        socket.userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],
                playlist: [],
                tttState: getInitialTTTState(),
                c4State: getInitialC4State()
            };
        }

        const room = rooms[roomId];
        room.users.push({ id: socket.id, username: socket.username, color: socket.userColor });

        io.to(roomId).emit('chat-message', {
            username: 'Système', message: `${socket.username} a rejoint le salon ! 🎉`, color: '#00f2fe', isSystem: true
        });

        io.to(roomId).emit('update-users', room.users);
        socket.emit('update-playlist', room.playlist);
        socket.emit('ttt-update', room.tttState);
        socket.emit('c4-update', room.c4State);

        if (room.users.length > 1) {
            io.to(room.users[0].id).emit('get-current-time-for-sync', { requesterId: socket.id });
        }
    });

    socket.on('change-video', (data) => socket.roomId && socket.to(socket.roomId).emit('user-changed-video', data));
    socket.on('video-action', (data) => socket.roomId && socket.to(socket.roomId).emit('user-video-action', data));
    socket.on('request-sync-force', () => {
        if (socket.roomId && rooms[socket.roomId]?.users.length > 1) {
            io.to(rooms[socket.roomId].users[0].id).emit('get-current-time-for-sync', { requesterId: socket.id });
        }
    });
    socket.on('respond-time-for-sync', ({ requesterId, currentTime, action }) => {
        io.to(requesterId).emit('user-video-action', { action, currentTime });
    });

    socket.on('request-peers-trigger', () => socket.roomId && socket.to(socket.roomId).emit('user-joined-webrtc', { id: socket.id, username: socket.username }));
    socket.on('video-offer', ({ sdp, to }) => io.to(to).emit('video-offer', { sdp, from: socket.id }));
    socket.on('video-answer', ({ sdp, to }) => io.to(to).emit('video-answer', { sdp, from: socket.id }));
    socket.on('new-ice-candidate', ({ candidate, to }) => io.to(to).emit('new-ice-candidate', { candidate, from: socket.id }));
    socket.on('audio-speaking', ({ isSpeaking }) => socket.roomId && socket.to(socket.roomId).emit('user-audio-speaking', { id: socket.id, isSpeaking }));

    socket.on('send-chat-message', ({ message }) => {
        if (socket.roomId) {
            io.to(socket.roomId).emit('chat-message', { username: socket.username, message, color: socket.userColor, isSystem: false });
        }
    });

    socket.on('add-to-playlist', ({ videoUrl }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const room = rooms[socket.roomId];
        room.playlist.push({
            id: 'item-' + Math.random().toString(36).substring(2, 9),
            url: videoUrl,
            title: videoUrl.length > 35 ? videoUrl.substring(0, 35) + '...' : videoUrl
        });
        io.to(socket.roomId).emit('update-playlist', room.playlist);
    });

    socket.on('remove-from-playlist', ({ itemId }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        rooms[socket.roomId].playlist = rooms[socket.roomId].playlist.filter(i => i.id !== itemId);
        io.to(socket.roomId).emit('update-playlist', rooms[socket.roomId].playlist);
    });

    // --- LOGIQUE SÉCURISÉE DU MORPION ---
    socket.on('ttt-move', ({ idx }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const state = rooms[socket.roomId].tttState;

        if (state.winner) return; // Partie déjà terminée

        // Attribution des rôles
        if (!state.playerX) state.playerX = socket.id;
        else if (!state.playerO && socket.id !== state.playerX) state.playerO = socket.id;

        // Vérification de la légitimité du joueur
        const currentSymbol = state.turn;
        const allowedSocketId = currentSymbol === 'X' ? state.playerX : state.playerO;

        if (socket.id !== allowedSocketId) return; // Ce n'est pas le tour de ce joueur !
        if (state.board[idx] !== '') return; // Case occupée

        state.board[idx] = currentSymbol;
        state.winner = checkTTTWinner(state.board);
        if (!state.winner) {
            state.turn = currentSymbol === 'X' ? 'O' : 'X';
        }

        io.to(socket.roomId).emit('ttt-update', state);
    });

    socket.on('ttt-reset', () => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        rooms[socket.roomId].tttState = getInitialTTTState();
        io.to(socket.roomId).emit('ttt-update', rooms[socket.roomId].tttState);
    });

    // --- LOGIQUE SÉCURISÉE DU PUISSANCE 4 ---
    socket.on('c4-move', ({ col }) => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        const state = rooms[socket.roomId].c4State;

        if (state.winner) return; // Partie déjà terminée !

        // Attribution des rôles
        if (!state.player1) state.player1 = socket.id;
        else if (!state.player2 && socket.id !== state.player1) state.player2 = socket.id;

        // Vérification de la légitimité du joueur
        const allowedSocketId = state.turn === 1 ? state.player1 : state.player2;
        if (socket.id !== allowedSocketId) return; // Ce n'est pas ton tour !

        // Placer le jeton
        let placed = false;
        for (let r = 5; r >= 0; r--) {
            if (state.board[r][col] === 0) {
                state.board[r][col] = state.turn;
                placed = true;
                break;
            }
        }

        if (!placed) return; // Colonne pleine

        // Vérifier la victoire
        state.winner = checkC4Winner(state.board);
        if (!state.winner) {
            state.turn = state.turn === 1 ? 2 : 1;
        }

        io.to(socket.roomId).emit('c4-update', state);
    });

    socket.on('c4-reset', () => {
        if (!socket.roomId || !rooms[socket.roomId]) return;
        rooms[socket.roomId].c4State = getInitialC4State();
        io.to(socket.roomId).emit('c4-update', rooms[socket.roomId].c4State);
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            room.users = room.users.filter(u => u.id !== socket.id);
            socket.to(roomId).emit('user-left-webrtc', { id: socket.id });

            if (room.users.length > 0) {
                io.to(roomId).emit('chat-message', { username: 'Système', message: `${socket.username} a quitté le salon.`, color: '#ff4e50', isSystem: true });
                io.to(roomId).emit('update-users', room.users);
            } else {
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Serveur StreamHub actif sur le port ${PORT}`));