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

function gerarDadosUltimos5Jogos(matchId) {
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
      mediaGols: (1.8 + (seed * 0.2)).toFixed(1),
      mediaFinalizacoes: (14.2 + seed).toFixed(1),
      mediaChutesNoGol: (5.5 + (seed * 0.3)).toFixed(1),
      mediaEscanteios: (5.4 + (seed * 0.3)).toFixed(1),
      mediaCartoes: (1.8 + (seed * 0.2)).toFixed(1)
    },
    away: {
      forma: formasAway[seed],
      mediaGols: (1.2 + (seed * 0.1)).toFixed(1),
      mediaFinalizacoes: (11.5 + seed).toFixed(1),
      mediaChutesNoGol: (3.8 + (seed * 0.2)).toFixed(1),
      mediaEscanteios: (4.6 + (seed * 0.2)).toFixed(1),
      mediaCartoes: (2.2 + (seed * 0.1)).toFixed(1)
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

        const ultimos5 = gerarDadosUltimos5Jogos(matchId);

        const docData = {
          id: matchId,
          homeTeam: home,
          awayTeam: away,
          league,
          country: item.competition.area?.name || "Internacional",
          matchDate: item.utcDate,
          statusPartida: item.status,
          arbitro: referee,
          ultimos5Jogos: ultimos5,
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
