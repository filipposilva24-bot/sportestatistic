const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    console.error("Erro Firebase:", error);
  }
}

const db = admin.firestore();

// Puxa os jogos do dia da Football-Data (Ligas de Elite)
async function buscarJogosDoDia(footballDataKey) {
  const agora = new Date();
  const hoje = agora.toISOString().split('T')[0]; // Formato YYYY-MM-DD
  
  const res = await fetch(`https://api.football-data.org/v4/matches?date=${hoje}`, { 
    headers: { 'X-Auth-Token': footballDataKey } 
  });
  
  if (!res.ok) throw new Error(`Erro football-data: ${res.status}`);
  const data = await res.json();
  if (!data.matches) return [];

  const ligasElite = ['CL', 'BL1', 'BSA', 'PD', 'FL1', 'EC', 'SA', 'PL'];
  return data.matches.filter(match => ligasElite.includes(match.competition?.code)).slice(0, 10);
}

// Puxa estatísticas reais da API do SofaScore (RapidAPI)
async function buscarEstatisticasSofaScore(home, away, rapidApiKey, rapidApiHost) {
  try {
    const query = encodeURIComponent(`${home} ${away}`);
    const res = await fetch(`https://${rapidApiHost}/search/unique-tournaments?q=${query}`, {
      headers: {
        'x-rapidapi-key': rapidApiKey,
        'x-rapidapi-host': rapidApiHost
      }
    });
    
    if (!res.ok) return { status: "Indisponível" };
    const data = await res.json();
    
    return {
      status: "Disponível",
      torneioEncontrado: data.uniqueTournaments?.[0]?.name || "Competição Oficial",
      rawSearch: data
    };
  } catch (e) {
    return { status: "Erro" };
  }
}

module.exports = async function handler(req, res) {
  const footballDataKey = process.env.FOOTBALL_DATA_KEY;
  const rapidApiKey = process.env.RAPID_API_KEY;
  const rapidApiHost = process.env.RAPID_API_HOST;
  
  if (!footballDataKey) {
    return res.status(500).json({ success: false, error: "Falta a chave da football-data.org" });
  }

  try {
    const matches = await buscarJogosDoDia(footballDataKey);
    
    if (!matches || matches.length === 0) {
       return res.status(200).json({ success: false, message: "Nenhum jogo de elite agendado para hoje." });
    }

    let processados = 0;

    const promessas = matches.map(async (item) => {
      try {
        const matchId = item.id;
        const home = item.homeTeam.name;
        const away = item.awayTeam.name;
        const league = item.competition.name;
        const referee = (item.referees && item.referees[0] && item.referees[0].name) || "Não divulgado";

        const statsSofa = (rapidApiKey && rapidApiHost) 
          ? await buscarEstatisticasSofaScore(home, away, rapidApiKey, rapidApiHost)
          : { status: "Não configurado" };

        const docData = {
          matchName: `${home} vs ${away}`,
          homeTeam: home,
          awayTeam: away,
          league,
          country: item.competition.area?.name || "Internacional",
          matchDate: item.utcDate,
          statusPartida: item.status,
          arbitro: referee,
          estatisticasSofaScore: statsSofa,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('match_stats').doc(String(matchId)).set(docData);
        processados++;
      } catch (err) {
        console.error(`Erro ao processar jogo ${item.id}:`, err.message);
      }
    });

    await Promise.all(promessas);

    return res.status(200).json({ 
      success: true, 
      message: `Estatísticas atualizadas! ${processados} jogos processados.` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message });
  }
};
