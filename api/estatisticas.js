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

async function buscarAgendaReal() {
  // Ajusta rigorosamente para o horário de Brasília (UTC-3)
  const agoraBrasil = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const hojeStr = agoraBrasil.toISOString().split('T')[0];
  
  const amanhaBrasil = new Date(agoraBrasil);
  amanhaBrasil.setDate(agoraBrasil.getDate() + 1);
  const amanhaStr = amanhaBrasil.toISOString().split('T')[0];
  
  console.log(`Buscando jogos para as datas: ${hojeStr} e ${amanhaStr}`);

  const [resHoje, resAmanha] = await Promise.all([
    fetch(`https://${API_HOST}/fixtures?date=${hojeStr}`, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } }),
    fetch(`https://${API_HOST}/fixtures?date=${amanhaStr}`, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } })
  ]);

  const dataHoje = resHoje.ok ? await resHoje.json() : { response: [] };
  const dataAmanha = resAmanha.ok ? await resAmanha.json() : { response: [] };

  let allFixtures = [...(dataHoje.response || []), ...(dataAmanha.response || [])];

  // SE por acaso o dia exato não retornar nada (ex: fuso extremo), busca os jogos AO VIVO do dia para garantir conteúdo na tela
  if (allFixtures.length === 0) {
    console.log("Nenhum jogo na data exata. Buscando jogos ao vivo (live=all)...");
    const resLive = await fetch(`https://${API_HOST}/fixtures?live=all`, { headers: { 'x-apisports-key': API_FOOTBALL_KEY } });
    const dataLive = resLive.ok ? await resLive.json() : { response: [] };
    allFixtures = dataLive.response || [];
  }

  return allFixtures;
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
       return res.status(200).json({ success: true, matches: [], message: "Nenhum jogo encontrado nem ao vivo nem na agenda de hoje." });
    }

    // Limitamos a 25 jogos para proteger estritamente o limite gratuito da API-Football
    const agendaLimitada = agenda.slice(0, 25);
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
            
            if (diffHoras < 6) {
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
          analisePartida: predictions?.advice || "Análise baseada no momento atual das equipes.",
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
      message: `Dados processados com sucesso! (${listaPartidas.length} jogos)` 
    });
  } catch (err) {
    return res.status(500).json({ success: false, erroCritico: err.message });
  }
};
