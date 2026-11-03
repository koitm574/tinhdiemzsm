// Shared model for the result journal and the Live Studio rundown.
(() => {
  const HISTORY_LIMIT = 24;
  const FIXTURE_LIMIT = 12;
  const SEMIS = Object.freeze([Object.freeze([0, 3]), Object.freeze([1, 2])]);
  const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

  const historyFor = game => Array.isArray(game?.resultHistory) ? game.resultHistory : [];
  const applyTimeChange = (game, change) => {
    if (game.times[change.slot] !== change.before || change.after === change.before) return game;
    return {
      ...game,
      times: game.times.map((time, slot) => slot === change.slot ? change.after : time),
      resultHistory: [...historyFor(game), change].slice(-HISTORY_LIMIT)
    };
  };
  const findUndo = (game, playerCount) => {
    const history = historyFor(game);
    const undone = new Set(history.filter(entry => entry.kind === 'undo').map(entry => entry.undoOf));
    return history.findLast(entry =>
      entry.kind === 'edit' && !undone.has(entry.id) && Number.isInteger(entry.slot) &&
      entry.slot >= 0 && entry.slot < playerCount && game.times[entry.slot] === entry.after
    );
  };
  const remapHistory = (game, remap) => {
    const history = historyFor(game);
    return history.length ? {
      ...game,
      resultHistory: history.map(entry => Number.isInteger(entry.slot) ? { ...entry, slot: remap(entry.slot) } : entry)
    } : game;
  };

  const normalizeRundown = saved => ({
    fixtures: (Array.isArray(saved?.fixtures) ? saved.fixtures : []).slice(0, FIXTURE_LIMIT)
      .filter(row => typeof row?.id === 'string')
      .map(row => ({ id: row.id, home: clean(row.home, 48), away: clean(row.away, 48), when: clean(row.when, 28), done: row.done === true })),
    bracket: normalizeBracket(saved?.bracket)
  });

  function normalizeBracket(saved) {
    const seeds = Array.from({ length: 4 }, (_, i) => clean(saved?.seeds?.[i], 48));
    const winners = SEMIS.map((pair, i) => {
      const winner = saved?.winners?.[i];
      return pair.every(seed => seeds[seed]) && pair.includes(winner) ? winner : null;
    });
    const champion = winners.every(Number.isInteger) && winners.includes(saved?.champion) ? saved.champion : null;
    return { seeds, winners, champion };
  }

  const bracketReady = bracket => bracket.seeds.every(Boolean) &&
    new Set(bracket.seeds.map(name => name.toLowerCase())).size === 4;

  const setSeed = (bracket, slot, name) => {
    const seed = clean(name, 48);
    if (bracket.seeds[slot] === seed) return bracket;
    const seeds = bracket.seeds.map((value, i) => i === slot ? seed : value);
    const winners = bracket.winners.map((winner, i) => SEMIS[i].includes(slot) ? null : winner);
    return { seeds, winners, champion: null };
  };

  const setWinner = (bracket, match, seed) => {
    if (match === 2) return normalizeBracket({ ...bracket, champion: seed });
    if (bracket.winners[match] === seed) return bracket;
    return normalizeBracket({
      ...bracket,
      winners: bracket.winners.map((winner, i) => i === match ? seed : winner),
      champion: null
    });
  };

  const upcoming = fixtures => fixtures.filter(row => !row.done && row.home && row.away).slice(0, 5);

  window.ZSM_OPERATIONS = Object.freeze({
    FIXTURE_LIMIT, HISTORY_LIMIT, SEMIS, historyFor, applyTimeChange, findUndo, remapHistory,
    normalizeRundown, bracketReady, setSeed, setWinner, upcoming
  });
})();
