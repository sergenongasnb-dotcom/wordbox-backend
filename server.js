const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

// ⚠️ CONFIGURATION IMPORTANTE - REMPLACE CE BLOC
const io = socketIo(server, {
  cors: {
    origin: "*",  // Autorise toutes les origines pour tester
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']  // Important pour Render
});

// Stockage en mémoire
const games = new Map();
const players = new Map();

// Dictionnaire simple de mots français
const FRENCH_WORDS = new Set([
  'ABLE', 'ABRI', 'ACRE', 'ACTE', 'ADIEU', 'AGENT', 'AIGLE', 'AIGRE', 
  'AIMER', 'AINSI', 'AIRER', 'AISSE', 'AJOUT', 'ALBUM', 'ALIAS', 'ALLEE',
  'ALLER', 'ALORS', 'AMANT', 'AMBRE', 'AMONT', 'AMOUR', 'AMPLE', 'ANCHE',
  'ANGE', 'ANGLE', 'ANIME', 'ANNEE', 'APRES', 'ARBRE', 'ARCHE', 'ARDER',
  'CHAIR', 'TABLE', 'MAISON', 'JARDIN', 'FLEUR', 'ARBRE', 'LIVRE', 'STYLO',
  'PAPIER', 'ECOLE', 'ELEVE', 'PROF', 'SOLEIL', 'LUNE', 'ETOILE', 'NUAGE',
  'PLUIE', 'VENT', 'AMOUR', 'RIRE', 'JOIE', 'PEUR', 'REVE', 'VIE', 'ROUGE',
  'VERT', 'BLEU', 'JAUNE', 'NOIR', 'BLANC', 'CHAT', 'CHIEN', 'OISEAU',
  'BANC', 'CAFE', 'THE', 'EAU', 'LAIT', 'PAIN', 'RIZ', 'SUCRE', 'SEL',
  'FROID', 'CHAUD', 'GRAND', 'PETIT', 'BEAU', 'JOLI', 'VIEUX', 'JEUNE'
]);

io.on('connection', (socket) => {
  console.log('🔌 Nouvelle connexion:', socket.id);

  // Rejoindre ou créer une partie
  socket.on('join-game', ({ roomCode, username }) => {
    console.log(`🎮 ${username} rejoint ${roomCode}`);
    
    socket.join(roomCode);
    
    if (!games.has(roomCode)) {
      // Nouvelle partie
      games.set(roomCode, {
        grid: generateGrid(),
        players: {},
        playerWords: {},
        startTime: null,
        status: 'waiting',
        timer: null
      });
      console.log(`🆕 Partie créée: ${roomCode}`);
    }
    
    const game = games.get(roomCode);
    game.players[socket.id] = { username, score: 0 };
    game.playerWords[socket.id] = [];
    players.set(socket.id, roomCode);
    
    // Envoyer la grille
    socket.emit('game-started', {
      grid: game.grid,
      roomCode,
      players: Object.values(game.players).map(p => p.username),
      myId: socket.id
    });
    
    // Informer les autres
    socket.to(roomCode).emit('player-joined', {
      username,
      players: Object.values(game.players).map(p => p.username)
    });
    
    // Si 2 joueurs, démarrer
    if (Object.keys(game.players).length === 2) {
      game.status = 'playing';
      game.startTime = Date.now();
      
      // Démarrer un timer de 2 minutes
      game.timer = setTimeout(() => {
        endGame(roomCode);
      }, 120000); // 2 minutes
      
      io.to(roomCode).emit('game-begin', { 
        grid: game.grid,
        startTime: game.startTime 
      });
      console.log(`🚀 Partie ${roomCode} commence avec 2 joueurs`);
    }
  });
  
  // Mot trouvé
  socket.on('word-found', ({ roomCode, word }) => {
    const game = games.get(roomCode);
    if (!game || game.status !== 'playing') return;
    
    // Validation du mot
    if (!FRENCH_WORDS.has(word.toUpperCase())) {
      socket.emit('word-invalid', { word });
      return;
    }
    
    // Vérifier si déjà trouvé par ce joueur
    if (game.playerWords[socket.id].includes(word.toUpperCase())) {
      socket.emit('word-duplicate', { word });
      return;
    }
    
    // Calcul du score
    const baseScore = word.length;
    let bonus = 0;
    if (word.length >= 6) bonus += 2;
    if (word.length >= 8) bonus += 3;
    const totalScore = baseScore + bonus;
    
    // Enregistrer
    game.playerWords[socket.id].push(word.toUpperCase());
    game.players[socket.id].score += totalScore;
    
    // Confirmation au joueur
    socket.emit('word-accepted', {
      word,
      score: totalScore,
      totalScore: game.players[socket.id].score
    });
    
    // Envoyer uniquement le score aux autres
    socket.to(roomCode).emit('score-updated', {
      playerId: socket.id,
      username: game.players[socket.id].username,
      score: game.players[socket.id].score
    });
    
    console.log(`📝 ${game.players[socket.id].username} trouve "${word}" (+${totalScore})`);
  });
  
  // Fin de partie (manuellement)
  socket.on('game-finished', ({ roomCode }) => {
    endGame(roomCode);
  });
  
  // Déconnexion
  socket.on('disconnect', () => {
    const roomCode = players.get(socket.id);
    if (roomCode) {
      const game = games.get(roomCode);
      if (game) {
        socket.to(roomCode).emit('player-left', {
          playerId: socket.id,
          username: game.players[socket.id]?.username
        });
        
        // Si plus de joueurs, nettoyer
        if (Object.keys(game.players).length <= 1) {
          if (game.timer) clearTimeout(game.timer);
          games.delete(roomCode);
          console.log(`🗑️ Partie ${roomCode} nettoyée`);
        }
      }
      players.delete(socket.id);
    }
    console.log('❌ Déconnexion:', socket.id);
  });
});

function endGame(roomCode) {
  const game = games.get(roomCode);
  if (!game || game.status === 'finished') return;
  
  game.status = 'finished';
  if (game.timer) clearTimeout(game.timer);
  
  // Préparer les résultats
  const results = Object.entries(game.players).map(([id, player]) => ({
    username: player.username,
    score: player.score,
    words: game.playerWords[id]
  }));
  
  // Trier par score
  results.sort((a, b) => b.score - a.score);
  
  // Envoyer à tous les joueurs
  io.to(roomCode).emit('game-results', results);
  
  console.log(`🏁 Partie ${roomCode} terminée`);
  console.log(`📊 Résultats:`, results);
}

function generateGrid() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const grid = [];
  for (let i = 0; i < 25; i++) {
    grid.push(letters[Math.floor(Math.random() * letters.length)]);
  }
  return grid;
}

// ⚠️ CETTE LIGNE EST IMPORTANTE POUR RENDER
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Serveur backend sur le port ${PORT}`);
  console.log(`🔗 URL: http://localhost:${PORT}`);
  console.log(`📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`🌐 Prêt pour les connexions...`);
});
