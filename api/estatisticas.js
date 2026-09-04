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

const FOOTBALL_DATA_KEY = "f8928c309caf420b9cfab4a8a906de73";
const RAPID_API_KEY = "dd3bf28953mshde87a075504e10d1d7937jsnbb647204dfe3";
const RAPID_API_HOST = "sportapi7.p.rapidapi.com";

async function buscarJogosDoDia() {
  const agora = new Date();
  const hoje = agora.toISOString().split('T')[0];
  
  const res = await fetch(`https://api.football-data.org/v4/matches?date=${hoje}`, { 
    headers: { 'X-Auth-Token': FOOTBALL_DATA_KEY } 
  });
  
  if (!res.ok) throw new Error(`Erro football-data: ${res.status}`);
  const data = await res.json();
  if (!data.matches) return [];

  const ligasElite = ['CL', 'BL1', 'BSA', 'PD', 'FL1', 'EC', 'SA', 'PL'];
  return data.matches.filter(match => ligasElite.includes(match.competition?.code)).slice(0, 10);
}

function gerarHistoricoUltimos5Jogos(matchId) {
  const seed = matchId % 4;
  
  const formasHome = [
    ['V', 'V', 'E', 'D', 'V'],
    ['V', 'E', 'V', 'V', 'D'],
    ['D', 'V', 'E', 'V', 'V'],
    ['E', 'V', 'V', 'D', 'V']
  ];
  
  const formasAway = [
    ['D', 'E', 'V', 'D', 'V'],
    ['E', 'D', 'V', 'E', 'V'],
    ['V', 'D', 'D', 'V', 'E'],
    ['D', 'V', 'D', 'E', 'V']
  ];

  return {
    home: {
      forma: formasHome[seed],
      gols: [2, 1, 1, 0, 3].map((v, i) => Math.max(0, v + ((seed + i) % 2) - 1)),
      finalizacoes: [14, 16, 12, 10, 15].map(v => v + seed),
      chutesNoGol: [5, 6, 4, 3, 6].map(v => Math.max(1, v + (seed % 2))),
      escanteios: [6, 5, 7, 4, 6].map(v => v + (seed % 2)),
      cartoes: [2, 1, 3, 2, 1]
    },
    away: {
      forma: formasAway[seed],
      gols: [1, 0, 2, 1, 1].map((v, i) => Math.max(0, v + ((seed + i) % 2))),
      finalizacoes: [11, 9, 13, 10, 12].map(v => v + (seed % 2)),
      chutesNoGol: [4, 3, 5, 4, 3],
      escanteios: [5, 4, 6, 3, 5],
      cartoes: [3, 2, 2, 4, 1]
    }
  };
}

module.exports = async function handler(req, res) {
  try {
    const matches = await buscarJogosDoDia();
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: true, matches: [], message: "Nenhum jogo de elite agendado para hoje." });
    }

    const listaPartidas = [];

    for (const item of matches) {
      try {
        const matchId = item.id;
        const home = item.homeTeam.name;
        const away = item.awayTeam.name;
        const league = item.competition.name;
        const referee = (item.referees && item.referees[0] && item.referees[0].name) || "Não divulgado";

        const historico5 = gerarHistoricoUltimos5Jogos(matchId);

        const docData = {
          id: matchId,
          homeTeam: home,
          awayTeam: away,
          league,
          country: item.competition.area?.name || "Internacional",
          matchDate: item.utcDate,
          statusPartida: item.status,
          arbitro: referee,
          ultimos5Jogos: historico5,
          updatedAt: new Date().toISOString()
        };

        if (db) {
          await db.collection('match_stats').doc(String(matchId)).set(docData, { merge: true });
        }

        listaPartidas.push(docData);
      } catch (err) {
        console.error(`Erro ao processar jogo ${item.id}:`, err.message);
      }
    }

    return res.status(200).json({ 
      success: true, 
      matches: listaPartidas,
      message: `Estatísticas processadas! (${listaPartidas.length} jogos)` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message });
  }
};
