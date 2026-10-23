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

  const champions = sharedChampions || new Map();
  if (!sharedChampions) {
    for (const [number, records] of recordsByTournament) {
      const losers = new Set(records.map((record) => String(record.loserId)));
      const participants = new Set(records.flatMap((record) => [
        String(record.winnerId),
        String(record.loserId),
      ]));
      const unbeaten = [...participants].filter((id) => !losers.has(id));
      if (unbeaten.length === 1) champions.set(number, unbeaten[0]);
    }
  }

  const tournamentNumbers = [...new Set(
    data.tournaments.map((t) => Number(t.number)).filter(Number.isFinite)
  )].sort((a, b) => a - b);
  const titleNumbers = tournamentNumbers
    .filter((number) => champions.get(number) === playerKey)
    .sort((a, b) => b - a);

  let currentStreak = 0;
  let maxStreak = 0;
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

function buildStatsFromRecords(records) {
  const stats = {};
  for (const record of records) {
    const winnerId = String(record.winnerId);
    const loserId = String(record.loserId);
    if (!winnerId || !loserId || winnerId === loserId) continue;

    stats[winnerId] ??= {};
    stats[loserId] ??= {};
    stats[winnerId][loserId] ??= { wins: 0, losses: 0 };
    stats[loserId][winnerId] ??= { wins: 0, losses: 0 };
    stats[winnerId][loserId].wins += 1;
    stats[loserId][winnerId].losses += 1;
  }

  for (const opponents of Object.values(stats)) {
    for (const stat of Object.values(opponents)) {
      const total = stat.wins + stat.losses;
      stat.rate = total ? Math.round((stat.wins / total) * 1000) / 10 : 0;
    }
  }
  return stats;
}

export function mergeData(oldData, newData) {
  if (!oldData) {
    const records = [...new Map(
      (newData.records || []).map((record) => [
        `${record.tournamentNumber}|${record.winnerId}|${record.loserId}`, record,
      ])
    ).values()];
    return { ...newData, records, stats: buildStatsFromRecords(records), matches: records.length };
  }

  const playerMap = new Map();
  for (const player of oldData.players || []) playerMap.set(String(player.id), player);
  for (const player of newData.players || []) playerMap.set(String(player.id), player);

  const tournamentMap = new Map();
  for (const tournament of oldData.tournaments || []) tournamentMap.set(Number(tournament.number), tournament);
  for (const tournament of newData.tournaments || []) tournamentMap.set(Number(tournament.number), tournament);

  // 取得し直した大会は、その大会の古い試合記録を丸ごと置き換える。
  // 同じ大会を再取得しても古い試合が残ったり、戦績が二重加算されたりしない。
  const replacedNumbers = new Set(
    (newData.tournaments || []).map((tournament) => Number(tournament.number))
  );
  const recordMap = new Map();
  for (const record of oldData.records || []) {
    if (replacedNumbers.has(Number(record.tournamentNumber))) continue;
    recordMap.set(
      `${record.tournamentNumber}|${record.winnerId}|${record.loserId}`, record
    );
  }
  for (const record of newData.records || []) {
    recordMap.set(
      `${record.tournamentNumber}|${record.winnerId}|${record.loserId}`, record
    );
  }

  const mergedTournaments = [...tournamentMap.values()].sort((a, b) => Number(a.number) - Number(b.number));
  const mergedRecords = [...recordMap.values()].sort(
    (a, b) => Number(a.tournamentNumber) - Number(b.tournamentNumber)
  );

  return {
    ...oldData,
    ...newData,
    players: [...playerMap.values()],
    tournaments: mergedTournaments,
    records: mergedRecords,
    // 集計値を加算するのではなく、統合後の試合記録から再計算する。
    stats: buildStatsFromRecords(mergedRecords),
    matches: mergedRecords.length,
    failed: newData.failed || [],
  };
}
