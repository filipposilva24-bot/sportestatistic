const admin = require('firebase-admin');

if (!admin.apps.length && process.env.FIREBASE_CREDENTIALS) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro Firebase:", error);
  }
}

const db = admin.apps.length ? admin.firestore() : null;

// Chaves integradas para funcionamento imediato
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

async function buscarEstatisticasSofaScore(home, away) {
  try {
    const query = encodeURIComponent(`${home} ${away}`);
    const res = await fetch(`https://${RAPID_API_HOST}/search/unique-tournaments?q=${query}`, {
      headers: {
        'x-rapidapi-key': RAPID_API_KEY,
        'x-rapidapi-host': RAPID_API_HOST
      }
    });
    
    if (!res.ok) return { status: "Indisponível" };
    const data = await res.json();
    
    return {
      status: "Disponível",
      torneioEncontrado: data.uniqueTournaments?.[0]?.name || "Competição Oficial"
    };
  } catch (e) {
    return { status: "Erro" };
  }
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

        const statsSofa = await buscarEstatisticasSofaScore(home, away);

        const docData = {
          id: matchId,
          homeTeam: home,
          awayTeam: away,
          league,
          country: item.competition.area?.name || "Internacional",
          matchDate: item.utcDate,
          statusPartida: item.status,
          arbitro: referee,
          estatisticasSofaScore: statsSofa
        };

        if (db) {
          await db.collection('match_stats').doc(String(matchId)).set(docData);
        }

        listaPartidas.push(docData);
      } catch (err) {
        console.error(`Erro ao processar jogo ${item.id}:`, err.message);
      }
    }

    return res.status(200).json({ 
      success: true, 
      matches: listaPartidas,
      message: `Estatísticas atualizadas! ${listaPartidas.length} jogos processados.` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message });
  }
};
