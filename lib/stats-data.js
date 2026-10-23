// 戦績データの集計・マージ処理。画面表示の実装から分離する。
export function getPlayerAchievements(data, playerId, sharedChampions = null) {
  if (!data?.tournaments?.length || !playerId) {
    return {
      titleNumbers: [],
      streak: 0,
      playedStreak: 0,
      matchWinRate: 0,
      matchWins: 0,
      matchCount: 0,
      tournamentWinRate: 0,
      tournamentWins: 0,
      tournamentCount: 0,
    };
  }

  const playerKey = String(playerId);
  const recordsByTournament = new Map();
  let matchWins = 0;
  let matchCount = 0;
  const participatedTournaments = new Set();

  for (const record of data.records || []) {
    const number = Number(record.tournamentNumber);
    if (!Number.isFinite(number)) continue;
    if (!recordsByTournament.has(number)) recordsByTournament.set(number, []);
    recordsByTournament.get(number).push(record);

    const winnerId = String(record.winnerId);
    const loserId = String(record.loserId);
    if (winnerId === playerKey || loserId === playerKey) {
      matchCount += 1;
      participatedTournaments.add(number);
      if (winnerId === playerKey) matchWins += 1;
    }
  }

  // 呼び出し元ですでに集計済みなら、その大会別優勝者マップを再利用する。
  const champions = sharedChampions || new Map();
  if (!sharedChampions) {
    for (const [number, records] of recordsByTournament) {
      // 大会内で一度も敗者になっていない選手を優勝候補とする。
      // 候補が1人だけの場合に限り優勝者として確定する。
      const losers = new Set(records.map((record) => String(record.loserId)));
      const participants = new Set(
        records.flatMap((record) => [
          String(record.winnerId),
          String(record.loserId),
        ])
      );
      const unbeaten = [...participants].filter((id) => !losers.has(id));

      if (unbeaten.length === 1) {
        champions.set(number, unbeaten[0]);
      }
    }
  }

  const tournamentNumbers = [...new Set(
    data.tournaments
      .map((t) => Number(t.number))
      .filter(Number.isFinite)
  )].sort((a, b) => a - b);

  const titleNumbers = tournamentNumbers
    .filter((number) => champions.get(number) === playerKey)
    .sort((a, b) => b - a);

  // 全期間の連続する大会で最大連覇数を数える。不参加・未優勝の大会で途切れる。
  let currentStreak = 0;
  let maxStreak = 0;

  // 参考値として、従来どおり出場した大会だけで連覇数を数える。
  let currentPlayedStreak = 0;
  let maxPlayedStreak = 0;

  for (const number of tournamentNumbers) {
    if (champions.get(number) === playerKey) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }

    if (participatedTournaments.has(number)) {
      if (champions.get(number) === playerKey) {
        currentPlayedStreak += 1;
        maxPlayedStreak = Math.max(maxPlayedStreak, currentPlayedStreak);
      } else {
        currentPlayedStreak = 0;
      }
    }
  }

  const tournamentWins = titleNumbers.length;
  const tournamentCount = participatedTournaments.size;

  return {
    titleNumbers,
    streak: maxStreak,
    playedStreak: maxPlayedStreak,
    matchWinRate: matchCount ? Math.round((matchWins / matchCount) * 1000) / 10 : 0,
    matchWins,
    matchCount,
    tournamentWinRate: tournamentCount
      ? Math.round((tournamentWins / tournamentCount) * 1000) / 10
      : 0,
    tournamentWins,
    tournamentCount,
  };
}
export function mergeStats(base = {}, added = {}) {
  const result = structuredClone(base || {});

  for (const [playerId, opponents] of Object.entries(added || {})) {
    result[playerId] ??= {};

    for (const [opponentId, stat] of Object.entries(opponents || {})) {
      result[playerId][opponentId] ??= { wins: 0, losses: 0 };

      result[playerId][opponentId].wins += stat.wins || 0;
      result[playerId][opponentId].losses += stat.losses || 0;

      const total =
        result[playerId][opponentId].wins +
        result[playerId][opponentId].losses;

      result[playerId][opponentId].rate = total
        ? Math.round(
            (result[playerId][opponentId].wins / total) * 1000
          ) / 10
        : 0;
    }
  }

  return result;
}

export function mergeData(oldData, newData) {
  if (!oldData) return newData;

  const playerMap = new Map();

  for (const player of oldData.players || []) {
    playerMap.set(String(player.id), player);
  }

  for (const player of newData.players || []) {
    playerMap.set(String(player.id), player);
  }

  const tournamentMap = new Map();

  for (const tournament of oldData.tournaments || []) {
    tournamentMap.set(Number(tournament.number), tournament);
  }

  for (const tournament of newData.tournaments || []) {
    tournamentMap.set(Number(tournament.number), tournament);
  }

  const recordMap = new Map();

  for (const record of oldData.records || []) {
    const key = `${record.tournamentNumber}|${record.winnerId}|${record.loserId}`;
    recordMap.set(key, record);
  }

  for (const record of newData.records || []) {
    const key = `${record.tournamentNumber}|${record.winnerId}|${record.loserId}`;
    recordMap.set(key, record);
  }

  const mergedTournaments = [...tournamentMap.values()].sort(
    (a, b) => a.number - b.number
  );

  const mergedRecords = [...recordMap.values()];

  return {
    ...oldData,
    ...newData,
    players: [...playerMap.values()],
    tournaments: mergedTournaments,
    records: mergedRecords,
    stats: mergeStats(oldData.stats, newData.stats),
    matches: mergedRecords.length,
    failed: newData.failed || [],
  };
}


