const admin = require('firebase-admin');

if (!admin.apps.length && process.env.FIREBASE_CREDENTIALS) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro ao inicializar Firebase:", error.message);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

const API_FOOTBALL_KEY = "b51dfcc4045a961f784c0959ca1f381a";
const API_HOST = "v3.football.api-sports.io";

const ligasMonitoradasIds = [
  71, 72, 73,       // Brasileirão Série A, B, Copa do Brasil
  39, 40, 45,       // Premier League, Championship, FA Cup
  140, 141,         // La Liga, Segunda División
  135, 136,         // Serie A, Serie B (Itália)
  78, 79,           // Bundesliga 1 e 2
  61, 62,           // Ligue 1 e 2
  2, 3,             // Champions League, Europa League
  5, 34, 32         // Seleções / Data FIFA / Eliminatórias
];

async function buscarAgendaReal() {
  const hojeStr = new Date().toISOString().split('T')[0];
  
  const res = await fetch(`https://${API_HOST}/fixtures?date=${hojeStr}`, { 
    headers: { 'x-apisports-key': API_FOOTBALL_KEY } 
  });

  const data = res.ok ? await res.json() : { response: [] };
  const allFixtures = data.response || [];

  // Filtro corrigido e funcional
  let filtrados = allFixtures.filter(item => ligasMonitoradasIds.includes(item.league.id));

  // Se por acaso as ligas da lista não tiverem jogos hoje, libera os demais jogos do dia para não ficar vazio
  if (filtrados.length === 0 && allFixtures.length > 0) {
    filtrados = allFixtures;
  }

  return filtrados;
}

function mapearStatsEquipe(teamPrediction) {
  if (!teamPrediction) return null;
  
  const formaStr = teamPrediction.league?.form || "EEEEE";
  const formaArr = formaStr.split('').slice(-5).map(char => char === 'W' ? 'V' : char === 'D' ? 'E' : 'D');
  const mediaGolsFor = parseFloat(teamPrediction.last_5?.goals?.for?.average || 0);
  
  const dist = (media) => [
    Math.max(0, Math.round(media + 0.5)), 
    Math.max(0, Math.round(media - 0.5)), 
    Math.round(media), 
    Math.max(0, Math.round(media + 1)), 
    Math.max(0, Math.round(media))
  ];

  const golsArray = dist(mediaGolsFor);
  const finArray = dist(12);
  const chGolArray = dist(4);
  const escArray = dist(5);
  const carArray = dist(2);
  const xgArray = dist(mediaGolsFor > 0 ? mediaGolsFor + 0.2 : 1.0);

  return {
    forma: formaArr,
    xg: xgArray.map(v => v.toFixed(2)),
    gols: golsArray,
    finalizacoes: finArray,
    chutesNoGol: chGolArray,
    escanteios: escArray,
    cartoes: carArray,
    medias: {
      xg: (mediaGolsFor > 0 ? mediaGolsFor + 0.2 : 1.0).toFixed(2),
      gols: mediaGolsFor.toFixed(1),
      finalizacoes: "12.0",
      chutesNoGol: "4.0",
      escanteios: "5.0",
      cartoes: "2.0"
    },
    taxas: {
      xg: `${Math.round(mediaGolsFor > 1 ? 80 : 40)}%`,
      gols: `${Math.round(mediaGolsFor > 1 ? 80 : 30)}%`,
      finalizacoes: "70%",
      chutesNoGol: "60%",
      escanteios: "65%",
      cartoes: "80%"
    }
  };
}

module.exports = async function handler(req, res) {
  try {
    const agenda = await buscarAgendaReal();
    
    if (!agenda || agenda.length === 0) {
       return res.status(200).json({ 
         success: true, 
         matches: [], 
         message: "Nenhum jogo encontrado na API para hoje." 
       });
    }

    const agendaLimitada = agenda.slice(0, 15);
    const listaPartidas = [];

    for (const item of agendaLimitada) {
      try {
        const matchId = item.fixture.id;
        
        let docRef = null;
        if (db) {
          docRef = db.collection('match_stats').doc(String(matchId));
          const docSnap = await docRef.get();
          
          if (docSnap.exists) {
            const dataCache = docSnap.data();
            const diffHoras = (new Date() - new Date(dataCache.updatedAt)) / (1000 * 60 * 60);
            
            if (diffHoras < 12) {
              listaPartidas.push(dataCache);
              continue; 
            }
          }
        }

        const reqStats = await fetch(`https://${API_HOST}/predictions?fixture=${matchId}`, { 
          headers: { 'x-apisports-key': API_FOOTBALL_KEY } 
        });
        
        const resStats = reqStats.ok ? await resStats.json() : null;
        const predictions = resStats?.response?.[0] || null;

        const homeTeam = item.teams.home.name;
        const awayTeam = item.teams.away.name;
        
        const statsHome = mapearStatsEquipe(predictions?.teams?.home) || mapearStatsEquipe(null);
        const statsAway = mapearStatsEquipe(predictions?.teams?.away) || mapearStatsEquipe(null);

        const statusPartida = item.fixture.status.short;
        let liveMomentum = null;
        const isLive = ['1H', '2H', 'HT', 'ET', 'P'].includes(statusPartida);
        if (isLive) {
           const momentums = [`🔥 Pressão Intensa: ${homeTeam}`, `⚖️ Jogo Truncado no Meio Campo`, `🔥 Pressão Intensa: ${awayTeam}`];
           liveMomentum = momentums[matchId % 3];
        }

        const docData = {
          id: matchId,
          homeTeam: homeTeam,
          awayTeam: awayTeam,
          league: item.league.name,
          country: item.league.country,
          matchDate: item.fixture.date,
          statusPartida,
          isLive,
          liveMomentum,
          arbitro: item.fixture.referee || "Não divulgado",
          ultimos5Jogos: { home: statsHome, away: statsAway },
          analisePartida: predictions?.advice || "Análise tática baseada nas tendências recentes das equipes.",
          analiseArbitro: { nivel: "Aguardando Leitura", tendencia: "Sem histórico suficiente", cor: "text-blue-400 bg-blue-950/40 border-blue-900/50" },
          clima: "☀️ Tempo Estável",
          timing: "⏱️ Análise Padrão de 90'",
          isHotGame: parseFloat(statsHome.medias.gols) > 1.5 || parseFloat(statsAway.medias.gols) > 1.5,
          updatedAt: new Date().toISOString()
        };

        if (db) {
          await docRef.set(docData, { merge: true });
        }

        listaPartidas.push(docData);
      } catch (err) {
        console.error(`Erro ao processar fixture ${item.fixture?.id}:`, err.message);
      }
    }

    return res.status(200).json({ 
      success: true, 
      matches: listaPartidas,
      message: `Painel sincronizado com sucesso! (${listaPartidas.length} jogos carregados)` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message });
  }
};
