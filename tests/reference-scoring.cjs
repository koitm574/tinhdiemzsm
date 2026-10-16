// Legacy behavior from main 74b38274b6ea29c726af89891e74831c5297ac12.
// Kept as a regression oracle for the server-side port, not loaded by the website.
  const parseTime = (val) => {
   val = String(val ?? '').trim();
   if (!val || val.toUpperCase() === 'X' || !/^[0-9:.,]+$/.test(val)) return null;
   if (val.includes(':') || val.includes('.') || val.includes(',')) {
    let m = 0, s = 0, c = 0;
    const parts = val.replace(',', '.').split(/[:.]/);
    if (parts.some(part => !/^\d+$/.test(part))) return null;
    if (parts.length === 3) [m, s, c] = parts.map(Number);
    else if (parts.length === 2) [s, c] = parts.map(Number);
    else return null;
    const ms = (m * 60000) + (s * 1000) + (c * 10);
    return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
   }
   const digits = val.replace(/\D/g, '');
   if (!digits) return null;
   let m = 0, s = 0, c = 0;
   if (digits.length >= 5) {
    c = Number(digits.slice(-2)); s = Number(digits.slice(-4, -2)); m = Number(digits.slice(0, -4));
   } else if (digits.length >= 3) {
    c = Number(digits.slice(-2)); s = Number(digits.slice(0, -2));
   } else {
    c = Number(digits);
   }
   const ms = (m * 60000) + (s * 1000) + (c * 10);
   return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
  };
  const isFinalTime = value => {
   const text = String(value ?? '').trim();
   return text.toUpperCase() === 'X' || (/^\d+:\d{2}\.\d{2}$/.test(text) && parseTime(text) !== null);
  };
  const getKingMapIndex = (pIndex, playerCount, gameMode) => {
   if (gameMode === 'solo') return pIndex + 1;
   const half = Math.floor(playerCount / 2);
   return pIndex < half ? 1 + pIndex * 2 : 2 + (pIndex - half) * 2;
  };
  const getFinalWinner = (t1, t2) => {
   if (!isFinalTime(t1) || !isFinalTime(t2)) return -1;
   const v1 = parseTime(t1), v2 = parseTime(t2);
   if (v1 === null && v2 === null) return -1;
   if (v1 === null) return 1;
   if (v2 === null) return 0;
   return v1 < v2 ? 0 : v2 < v1 ? 1 : -1;
  };
  const get1v1MatchStatus = (games, matchBO, setBO) => {
   const gameAssignments = games.map((g, i) => ({ set: Math.floor(i / setBO) + 1, round: i % setBO + 1 }));
   const mapsUsedSet12 = [], mapsUsedSet3 = [], sets = [], countedGames = [];
   games.forEach((g, i) => { if (g.mapId) (gameAssignments[i].set < 3 ? mapsUsedSet12 : mapsUsedSet3).push(g.mapId); });
   const winCond = Math.ceil(setBO / 2), matchWinCond = Math.ceil(matchBO / 2);
   let p1Sets = 0, p2Sets = 0, p1Rounds = 0, p2Rounds = 0, currentSet = 1, winner = -1;
   for (let set = 1; set <= matchBO; set++) {
    const info = { set, p1Rounds: 0, p2Rounds: 0, finished: false, lastGameIndex: -1, lastWinner: -1 };
    for (let round = 0; round < setBO; round++) {
     const index = (set - 1) * setBO + round, game = games[index];
     if (!game || !isFinalTime(game.times[0]) || !isFinalTime(game.times[1])) continue;
     const result = getFinalWinner(game.times[0], game.times[1]);
     countedGames.push(index); info.lastGameIndex = index; info.lastWinner = result;
     if (result === 0) info.p1Rounds++;
     if (result === 1) info.p2Rounds++;
     if (info.p1Rounds >= winCond || info.p2Rounds >= winCond) { info.finished = true; break; }
    }
    sets.push(info); currentSet = set; p1Rounds = info.p1Rounds; p2Rounds = info.p2Rounds;
    if (!info.finished) break;
    if (info.p1Rounds >= winCond) p1Sets++; else p2Sets++;
    if (p1Sets >= matchWinCond || p2Sets >= matchWinCond) { winner = p1Sets >= matchWinCond ? 0 : 1; break; }
   }
   return { p1Sets, p2Sets, p1Rounds, p2Rounds, currentSet, winner, isFinished: winner !== -1, sets, countedGames, gameAssignments, mapsUsedSet12, mapsUsedSet3 };
  };

function referenceCalculate(input) {
 const {p_games:games,p_mode:gameMode,p_match_bo:matchBO,p_set_bo:setBO,p_player_count:count}=input;
 const players=Array(count).fill('');
 const NORMAL_TOP_SCORE=11,KING_TOP_SCORE=12;
 const matchStatus1v1=gameMode==='1v1'?get1v1MatchStatus(games,matchBO,setBO):null;
   const calculateGame = (gameIndex, times) => {
    const parsed = times.slice(0, players.length).map(parseTime);
    const valids = parsed.filter(t => t !== null);
    const bestTime = valids.length > 0 ? Math.min(...valids) : null;
    return parsed.map((timeMs, pIndex) => {
     if (gameMode === '1v1') {
      const isBest = getFinalWinner(times[0], times[1]) === pIndex && !!matchStatus1v1?.countedGames.includes(gameIndex);
      return { score: isBest ? 1 : 0, isBest: isBest, isKingMap: false, colorClass: isBest ? 'text-amber-950 bg-amber-400 font-black shadow-[0_5px_15px_rgba(251,191,36,0.4)] border-amber-300' : 'text-slate-500 bg-slate-900/80 border-transparent' };
     }
     const kingMapGameIndex = getKingMapIndex(pIndex, players.length, gameMode);
     const isKingMap = (gameIndex === kingMapGameIndex);
     if (timeMs === null) return { score: 0, isBest: false, isKingMap, colorClass: 'text-slate-600 bg-slate-900/50 border-transparent' };
     const isBest = (timeMs === bestTime);
     let score = 0, colorClass = 'text-cyan-400 bg-slate-800/80 border-transparent hover:border-slate-600';
     if (isBest) {
      score = isKingMap ? KING_TOP_SCORE : NORMAL_TOP_SCORE;
      colorClass = isKingMap ? 'text-red-100 bg-red-600 font-black shadow-[0_5px_15px_rgba(220,38,38,0.4)] border-red-400' : 'text-amber-950 bg-amber-400 font-black shadow-[0_5px_15px_rgba(251,191,36,0.4)] border-amber-300';
     } else {
      const diffSec = Math.floor((timeMs - bestTime) / 1000);
      score = Math.max(0, 10 - diffSec);
      if (score === 0) colorClass = 'text-slate-500 bg-slate-900/80 border-transparent';
     }
     return { score, isBest, isKingMap, colorClass };
    });
   };
 return {scores:games.map((g,i)=>calculateGame(i,g.times).map(({score,isBest,isKingMap})=>({score,isBest,isKingMap}))),matchStatus:matchStatus1v1};
}
module.exports={parseTime,referenceCalculate};
