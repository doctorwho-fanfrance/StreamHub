const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http'); // Requis pour encapsuler Express avec Socket.io
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app); // On crée le serveur HTTP
const io = new Server(server); // On attache Socket.io au serveur HTTP

const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'videos.json');

// Configuration du stockage des vidéos téléchargées
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'videos/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/videos', express.static('videos'));

// --- FONCTIONS DE LECTURE/ÉCRITURE JSON ---
function readVideosFromFile() {
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Erreur de lecture du fichier de sauvegarde:", err);
    return [];
  }
}

function writeVideosToFile(videos) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(videos, null, 2), 'utf8');
  } catch (err) {
    console.error("Erreur d'écriture du fichier de sauvegarde:", err);
  }
}

// --- ROUTES API EXISTANTES ---
app.post('/upload-file', upload.single('videoFile'), (req, res) => {
  if (!req.file) return res.status(400).send('Aucun fichier reçu.');
  const videoList = readVideosFromFile();
  videoList.push({ 
    id: Date.now().toString(), 
    title: req.file.originalname, 
    url: `/videos/${req.file.filename}`,
    isLocal: true 
  });
  writeVideosToFile(videoList);
  res.redirect('/');
});

app.post('/upload-link', (req, res) => {
  const { videoLink, videoTitle } = req.body;
  if (!videoLink) return res.status(400).send('Lien manquant.');
  const videoList = readVideosFromFile();
  videoList.push({ 
    id: Date.now().toString(), 
    title: videoTitle || 'Vidéo Web', 
    url: videoLink,
    isLocal: false 
  });
  writeVideosToFile(videoList);
  res.redirect('/');
});

app.get('/api/videos', (req, res) => {
  res.json(readVideosFromFile());
});

app.delete('/api/videos/:id', (req, res) => {
  const videoId = req.params.id;
  let videoList = readVideosFromFile();
  const videoToDelete = videoList.find(v => v.id === videoId);
  
  if (!videoToDelete) return res.status(404).json({ success: false, message: "Vidéo introuvable" });

  if (videoToDelete.isLocal) {
    const fileName = videoToDelete.url.replace('/videos/', '');
    const filePath = path.join(__dirname, 'videos', fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  videoList = videoList.filter(v => v.id !== videoId);
  writeVideosToFile(videoList);
  res.json({ success: true, message: "Vidéo supprimée avec succès" });
});

// --- LOGIQUE TEMPS RÉEL (SOCKET.IO) POUR LES SALONS ---
// Structure pour stocker l'état de chaque salon : { roomCode: { currentVideoUrl: '...', currentAudioUrl: '...' } }
const activeRooms = {};

io.on('connection', (socket) => {
  console.log(`Utilisateur connecté : ${socket.id}`);

  // 1. Créer un salon (L'utilisateur devient implicitement l'Hôte côté client)
  socket.on('createRoom', () => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase(); // Génère un code unique à 6 lettres
    activeRooms[roomCode] = { currentVideoUrl: null, currentAudioUrl: null };
    socket.join(roomCode);
    socket.emit('roomCreated', roomCode);
    console.log(`Salon créé avec succès : ${roomCode}`);
  });

  // 2. Rejoindre un salon (L'utilisateur devient un Invité)
  socket.on('joinRoom', (roomCode) => {
    if (activeRooms[roomCode]) {
      socket.join(roomCode);
      socket.emit('roomJoined', roomCode);
      
      // Si du contenu est déjà en cours de diffusion dans ce salon, on synchronise le nouvel arrivant
      if (activeRooms[roomCode].currentVideoUrl) {
        socket.emit('changeVideo', activeRooms[roomCode].currentVideoUrl);
      }
      if (activeRooms[roomCode].currentAudioUrl) {
        socket.emit('changeAudio', activeRooms[roomCode].currentAudioUrl);
      }
      console.log(`Utilisateur ${socket.id} a rejoint le salon : ${roomCode}`);
    } else {
      socket.emit('roomError', 'Code de salon invalide ou inexistant.');
    }
  });

  // 3. Action : Changement de la vidéo (Uniquement envoyé par l'Hôte depuis le front)
  socket.on('videoSelected', ({ roomCode, videoUrl }) => {
    if (activeRooms[roomCode]) {
      activeRooms[roomCode].currentVideoUrl = videoUrl;
      // On diffuse la mise à jour à TOUT LE MONDE connecté dans ce salon
      io.to(roomCode).emit('changeVideo', videoUrl);
    }
  });

  // 4. Action : Changement de la musique de fond (Uniquement envoyé par l'Hôte depuis le front)
  socket.on('audioSelected', ({ roomCode, audioUrl }) => {
    if (activeRooms[roomCode]) {
      activeRooms[roomCode].currentAudioUrl = audioUrl;
      // On diffuse la musique à TOUT LE MONDE connecté dans ce salon
      io.to(roomCode).emit('changeAudio', audioUrl);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Utilisateur déconnecté : ${socket.id}`);
  });
});

// Rappel majeur : on lance l'écoute sur "server" (HTTP + WebSockets) et plus sur "app" uniquement
server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});