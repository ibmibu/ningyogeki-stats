'use client';

import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ningyogeki-stats-v4';

function rate(stat) {
  return stat ? `${stat.rate}%` : '—';
}

function getPlayerAchievements(data, playerId) {
  if (!data?.tournaments?.length || !playerId) {
    return {
      titleNumbers: [],
      streak: 0,
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

  const champions = new Map();
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

  const tournamentNumbers = [...new Set(
    data.tournaments
      .map((t) => Number(t.number))
      .filter(Number.isFinite)
  )].sort((a, b) => a - b);

  const titleNumbers = tournamentNumbers
    .filter((number) => champions.get(number) === playerKey)
    .sort((a, b) => b - a);

  // 全期間を対象に、選手が参加した大会だけで最大連覇数を数える。
  // 不参加の大会は連覇を途切れさせず、参加して優勝できなかった大会で途切れる。
  let currentStreak = 0;
  let maxStreak = 0;

  const playedTournamentNumbers = tournamentNumbers.filter(
    (number) => participatedTournaments.has(number)
  );

  for (const number of playedTournamentNumbers) {
    if (champions.get(number) === playerKey) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const tournamentWins = titleNumbers.length;
  const tournamentCount = participatedTournaments.size;

  return {
    titleNumbers,
    streak: maxStreak,
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
function mergeStats(base = {}, added = {}) {
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

function mergeData(oldData, newData) {
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

const ELO_INITIAL_RATING = 1500;
const ELO_K = 64;
const ELO_LOSS_K = 64;
const ELO_RATING_SCALE = 747.2;

const GLICKO2_SCALE = 173.7178;
const GLICKO2_TAU = 0.5;
const GLICKO2_INITIAL_RD = 350;
const GLICKO2_INITIAL_VOLATILITY = 0.06;

// 大会は原則週1回なので、大会番号の間隔を経過時間の代理として使う。
// 1大会空くごとにRDが10増える。
const RD_INACTIVITY_INCREASE_PER_TOURNAMENT = 10;

function eloExpected(rating, opponentRating) {
  return 1 / (
    1 +
    Math.pow(
      10,
      (opponentRating - rating) / ELO_RATING_SCALE
    )
  );
}

// Glicko-2のg(RD)。相手のRDが大きいほど、その対戦結果から得られる
// 情報量を小さくし、Eloの変動幅も小さくする。
function glicko2GFromRD(rd) {
  const phi = rd / GLICKO2_SCALE;
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function glicko2Expected(mu, opponentMu, opponentPhi) {
  return 1 / (
    1 +
    Math.exp(
      -glicko2GFromRD(opponentPhi * GLICKO2_SCALE) *
        (mu - opponentMu)
    )
  );
}

function glicko2F(x, delta, phi, v, a) {
  const ex = Math.exp(x);

  return (
    (ex * (delta * delta - phi * phi - v - ex)) /
      (2 * Math.pow(phi * phi + v + ex, 2)) -
    (x - a) / (GLICKO2_TAU * GLICKO2_TAU)
  );
}

// レートはEloで更新し、RDとvolatilityだけをGlicko-2方式で更新する。
// RDはシーズンをまたいで引き継ぐ。
function updateRdPlayer(player, opponent, score) {
  const mu =
    (player.rating - ELO_INITIAL_RATING) /
    GLICKO2_SCALE;
  const phi = player.rd / GLICKO2_SCALE;
  const sigma = player.volatility;

  const opponentMu =
    (opponent.rating - ELO_INITIAL_RATING) /
    GLICKO2_SCALE;
  const opponentPhi = opponent.rd / GLICKO2_SCALE;

  const g = glicko2GFromRD(opponent.rd);
  const expected = 1 / (
    1 +
    Math.exp(-g * (mu - opponentMu))
  );

  const v =
    1 /
    (g * g * expected * (1 - expected));

  const delta =
    v * g * (score - expected);

  const a = Math.log(sigma * sigma);
  let A = a;
  let B;

  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;

    while (
      glicko2F(
        a - k * GLICKO2_TAU,
        delta,
        phi,
        v,
        a
      ) < 0
    ) {
      k += 1;
    }

    B = a - k * GLICKO2_TAU;
  }

  let fA = glicko2F(A, delta, phi, v, a);
  let fB = glicko2F(B, delta, phi, v, a);

  for (
    let i = 0;
    i < 100 && Math.abs(B - A) > 0.000001;
    i += 1
  ) {
    const C =
      A +
      ((A - B) * fA) /
        (fB - fA);

    const fC = glicko2F(
      C,
      delta,
      phi,
      v,
      a
    );

    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }

    B = C;
    fB = fC;
  }

  const newSigma = Math.exp(A / 2);
  const phiStar = Math.sqrt(
    phi * phi +
      newSigma * newSigma
  );

  const newPhi =
    1 /
    Math.sqrt(
      1 / (phiStar * phiStar) +
        1 / v
    );

  return {
    rd: Math.min(
      GLICKO2_INITIAL_RD,
      GLICKO2_SCALE * newPhi
    ),
    volatility: newSigma,
  };
}

function applyInactivityRd(player, tournamentNumber) {
  const currentTournament = Number(tournamentNumber) || 0;
  const lastTournament = Number(player.lastPlayedTournamentNumber) || 0;

  if (!currentTournament || !lastTournament) {
    return;
  }

  const gap = Math.max(0, currentTournament - lastTournament - 1);

  if (gap > 0) {
    player.rd = Math.min(
      GLICKO2_INITIAL_RD,
      player.rd +
        gap * RD_INACTIVITY_INCREASE_PER_TOURNAMENT
    );
  }
}

function updateEloPlayer(
  player,
  opponent,
  score,
  kOverride = null,
  disableRatingLossFactor = false
) {
  const expected = eloExpected(
    player.rating,
    opponent.rating
  );

  // 相手のRDが自分より大きい場合、相手の実力が高い可能性を考慮する。
  // 勝利時はRD差200以上で最大1.5倍、敗北時はRD差100以上で0.25倍まで減らす。
  const rdDifference = Math.max(
    0,
    opponent.rd - player.rd
  );

  const rdFactor =
    score === 1
      ? disableRatingLossFactor
        ? 1
        : 1 + (Math.min(rdDifference, 200) / 200) * 0.5
      : disableRatingLossFactor
        ? 1
        : Math.max(0.25, 1 - (rdDifference / 100) * 0.75);

  const kValue =
    kOverride ?? (score === 1 ? ELO_K : ELO_LOSS_K);

  const delta =
    kValue *
    rdFactor *
    (score - expected);

  return {
    rating: player.rating + delta,
    delta,
  };
}

function calculateElo(data, season = 'all') {
  if (!data?.records?.length) {
    return { ranking: [], history: [] };
  }

  const allRecords = [...data.records].sort(
    (a, b) =>
      (Number(a.tournamentNumber) || 0) -
      (Number(b.tournamentNumber) || 0)
  );

  const getSeasonRecords = (seasonNumber) =>
    allRecords.filter((record) => {
      const n =
        Number(record.tournamentNumber) || 0;

      return (
        n >=
          (seasonNumber - 1) * 25 + 1 &&
        n <= seasonNumber * 25
      );
    });

  const createPlayers = () => {
    const players = new Map();

    for (const player of data.players || []) {
      players.set(String(player.id), {
        id: player.id,
        name: player.name,
        rating: ELO_INITIAL_RATING,
        rd: GLICKO2_INITIAL_RD,
        volatility:
          GLICKO2_INITIAL_VOLATILITY,
        lastPlayedTournamentNumber: null,
        wins: 0,
        losses: 0,
      });
    }

    return players;
  };

  const updateRdOnly = (
    players,
    records
  ) => {
    for (const record of records) {
      const winner = players.get(
        String(record.winnerId)
      );
      const loser = players.get(
        String(record.loserId)
      );

      if (!winner || !loser) continue;

      const tournamentNumber = Number(record.tournamentNumber) || 0;
      applyInactivityRd(winner, tournamentNumber);
      applyInactivityRd(loser, tournamentNumber);

      const winnerBefore = {
        rating: winner.rating,
        rd: winner.rd,
        volatility:
          winner.volatility,
      };

      const loserBefore = {
        rating: loser.rating,
        rd: loser.rd,
        volatility:
          loser.volatility,
      };

      const winnerNext =
        updateRdPlayer(
          winnerBefore,
          loserBefore,
          1
        );

      const loserNext =
        updateRdPlayer(
          loserBefore,
          winnerBefore,
          0
        );

      winner.rd = winnerNext.rd;
      winner.volatility =
        winnerNext.volatility;

      loser.rd = loserNext.rd;
      loser.volatility =
        loserNext.volatility;
      winner.lastPlayedTournamentNumber = tournamentNumber;
      loser.lastPlayedTournamentNumber = tournamentNumber;
    }
  };

  const processRecords = (
    players,
    records,
    collectHistory = false
  ) => {
    const history = [];

    // 1試合ずつ処理。Eloはシーズン内でリセットするが、
    // RDは全シーズンを通して同じ選手状態を引き継ぐ。
    for (const record of records) {
      const winner = players.get(
        String(record.winnerId)
      );
      const loser = players.get(
        String(record.loserId)
      );

      if (!winner || !loser) {
        if (collectHistory) {
          history.push({
            ...record,
            winnerBefore: null,
            winnerAfter: null,
            winnerDelta: null,
            loserBefore: null,
            loserAfter: null,
            loserDelta: null,
            winnerRd: null,
            loserRd: null,
          });
        }

        continue;
      }

      const tournamentNumber = Number(record.tournamentNumber) || 0;
      applyInactivityRd(winner, tournamentNumber);
      applyInactivityRd(loser, tournamentNumber);

      const winnerBefore =
        Math.round(winner.rating);
      const loserBefore =
        Math.round(loser.rating);

      const winnerState = {
        rating: winner.rating,
        rd: winner.rd,
        volatility:
          winner.volatility,
      };

      const loserState = {
        rating: loser.rating,
        rd: loser.rd,
        volatility:
          loser.volatility,
      };

      // 両者とも試合前のレート/RDを使って同時に計算する。
      // すべてのランキングで勝利・敗北ともK=64。
      const kOverride = null;

      const winnerAfterElo =
        updateEloPlayer(
          winnerState,
          loserState,
          1,
          kOverride,
          season === 'all'
        );

      const loserAfterElo =
        updateEloPlayer(
          loserState,
          winnerState,
          0,
          kOverride,
          season === 'all'
        );

      const winnerAfterRd =
        updateRdPlayer(
          winnerState,
          loserState,
          1
        );

      const loserAfterRd =
        updateRdPlayer(
          loserState,
          winnerState,
          0
        );

      winner.rating =
        winnerAfterElo.rating;
      winner.rd =
        winnerAfterRd.rd;
      winner.volatility =
        winnerAfterRd.volatility;
      winner.wins += 1;

      loser.rating =
        loserAfterElo.rating;
      loser.rd =
        loserAfterRd.rd;
      loser.volatility =
        loserAfterRd.volatility;
      loser.losses += 1;
      winner.lastPlayedTournamentNumber = tournamentNumber;
      loser.lastPlayedTournamentNumber = tournamentNumber;

      if (collectHistory) {
        const winnerAfter =
          Math.round(winner.rating);
        const loserAfter =
          Math.round(loser.rating);

        history.push({
          ...record,
          winnerBefore,
          winnerAfter,
          winnerDelta:
            winnerAfter - winnerBefore,
          loserBefore,
          loserAfter,
          loserDelta:
            loserAfter - loserBefore,
          winnerRd:
            Math.round(winner.rd),
          loserRd:
            Math.round(loser.rd),
        });
      }
    }

    return history;
  };

  const players = createPlayers();

  if (season === 'all') {
    const history =
      processRecords(
        players,
        allRecords,
        true
      );

    const ranking = [...players.values()]
      .filter(
        (player) =>
          player.wins + player.losses > 0
      )
      .map((player) => ({
        ...player,
        rating: Math.round(
          player.rating
        ),
        rd: Math.round(player.rd),
        total:
          player.wins +
          player.losses,
      }))
      .sort(
        (a, b) =>
          b.rating - a.rating ||
          b.total - a.total ||
          String(a.name).localeCompare(
            String(b.name),
            'ja'
          )
      );

    return { ranking, history };
  }

  const seasonNumber =
    Number(season);

  if (
    !Number.isFinite(
      seasonNumber
    ) ||
    seasonNumber < 1
  ) {
    return {
      ranking: [],
      history: [],
    };
  }

  const seasonStart =
    (seasonNumber - 1) * 25 + 1;

  // Eloだけを選択シーズン開始時に1500へリセットする。
  // RDはそれ以前の全試合から引き継ぐ。
  updateRdOnly(
    players,
    allRecords.filter(
      (record) =>
        (Number(
          record.tournamentNumber
        ) || 0) < seasonStart
    )
  );

  const history =
    processRecords(
      players,
      getSeasonRecords(
        seasonNumber
      ),
      true
    );

  const ranking = [...players.values()]
    .filter(
      (player) =>
        player.wins + player.losses > 0
    )
    .map((player) => ({
      ...player,
      rating: Math.round(
        player.rating
      ),
      rd: Math.round(player.rd),
      total:
        player.wins +
        player.losses,
    }))
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        b.total - a.total ||
        String(a.name).localeCompare(
          String(b.name),
          'ja'
        )
    );

  return { ranking, history };
}

function calculateTournamentTierScores(data) {
  const tournaments = Array.isArray(data?.tournaments) ? data.tournaments : [];
  const records = Array.isArray(data?.records) ? data.records : [];
  if (!tournaments.length || !records.length) return {};

  const ratingCache = new Map();
  const getSeasonRatings = (seasonNumber, beforeTournamentNumber = Infinity) => {
    const cacheKey = `${seasonNumber}:${beforeTournamentNumber}`;
    if (ratingCache.has(cacheKey)) return ratingCache.get(cacheKey);

    const seasonRecords = records.filter((record) => {
      const n = Number(record.tournamentNumber) || 0;
      return n < beforeTournamentNumber;
    });
    const result = calculateElo(
      { ...data, records: seasonRecords },
      String(seasonNumber)
    );
    const ratings = new Map(
      result.ranking.map((player) => [String(player.id), Number(player.rating) || ELO_INITIAL_RATING])
    );
    ratingCache.set(cacheKey, ratings);
    return ratings;
  };

  const scores = {};
  for (const tournament of tournaments) {
    const tournamentNumber = Number(tournament.number) || 0;
    if (!tournamentNumber) continue;

    const seasonNumber = Math.floor((tournamentNumber - 1) / 25) + 1;
    const positionInSeason = ((tournamentNumber - 1) % 25) + 1;
    const usePreviousSeason = seasonNumber > 1 && positionInSeason <= 5;

    let ratings;
    if (usePreviousSeason) {
      ratings = getSeasonRatings(seasonNumber - 1, (seasonNumber - 1) * 25 + 1);
    } else {
      ratings = getSeasonRatings(seasonNumber, tournamentNumber);
    }

    const participants = new Set();
    for (const record of records) {
      if ((Number(record.tournamentNumber) || 0) !== tournamentNumber) continue;
      if (record.winnerId != null) participants.add(String(record.winnerId));
      if (record.loserId != null) participants.add(String(record.loserId));
    }

    let total = 0;
    for (const playerId of participants) {
      total += ratings.get(playerId) ?? ELO_INITIAL_RATING;
    }
    scores[tournamentNumber] = Math.round(total);
  }

  return scores;
}

function getRecentResults(records, playerId, opponentId) {
  if (!Array.isArray(records)) return [];

  const player = String(playerId);
  const opponent = String(opponentId);

  return records
    .filter((record) => {
      const winnerId = record?.winnerId;
      const loserId = record?.loserId;

      if (winnerId == null || loserId == null) {
        return false;
      }

      const winner = String(winnerId);
      const loser = String(loserId);

      return (
        (winner === player && loser === opponent) ||
        (winner === opponent && loser === player)
      );
    })
    .sort(
      (a, b) =>
        (Number(b.tournamentNumber) || 0) -
        (Number(a.tournamentNumber) || 0)
    )
    .slice(0, 5)
    .map((record) => ({
      result:
        String(record.winnerId) === player
          ? 'W'
          : 'L',
      tournamentNumber:
        Number(record.tournamentNumber) || 0,
    }));
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    return localStorage.getItem('ningyogeki-selected-player') || 'all';
  });
  const [show, setShow] = useState(false);
  const [sortKey, setSortKey] = useState('opponent');
  const [sortDir, setSortDir] = useState('asc');
  const [season, setSeason] = useState('current');
  const [rateChartPlayers, setRateChartPlayers] = useState([]);

  async function loadLatest(savedData = data, forceFull = false) {
    setLoading(true);
    setError('');

    try {
      const known = forceFull
        ? ''
        : [...(savedData?.tournaments || [])]
            .map((t) => Number(t.number))
            .filter(Number.isFinite)
            .sort((a, b) => a - b)
            .join(',');

      const url = known
        ? `/api/series?known=${encodeURIComponent(known)}`
        : '/api/series';

      const response = await fetch(url, {
        cache: 'no-store',
      });

      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error || '取得に失敗しました');
      }

      if (
        savedData &&
        (!json.tournaments || json.tournaments.length === 0)
      ) {
        return;
      }

      setData((current) => mergeData(current || savedData, json));
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? e.message
          : 'データの取得に失敗しました'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let savedData = null;

    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed = JSON.parse(saved);

        if (
          parsed?.players &&
          parsed?.stats &&
          parsed?.tournaments
        ) {
          savedData = parsed;
          setData(parsed);
        }
      }
    } catch (e) {
      console.error(
        '保存データの読み込みに失敗しました',
        e
      );
    }

    loadLatest(savedData);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ningyogeki-selected-player', selected);
    } catch (e) {
      console.error('選択中の選手の保存に失敗しました', e);
    }
  }, [selected]);

  useEffect(() => {
    if (!data) return;

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(data)
      );
    } catch (e) {
      console.error(
        'データ保存に失敗しました',
        e
      );
    }
  }, [data]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((dir) =>
        dir === 'desc' ? 'asc' : 'desc'
      );
    } else {
      setSortKey(key);
      setSortDir(
        key === 'opponent' ? 'asc' : 'desc'
      );
    }
  }

  function sortMark(key) {
    return sortKey === key
      ? sortDir === 'asc'
        ? ' ▲'
        : ' ▼'
      : '';
  }

  function resetData() {
    if (
      !window.confirm(
        '保存データを削除して、全大会を最初から取得し直しますか？'
      )
    ) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('ningyogeki-selected-player');
    setData(null);
    setSelected('all');
    setSeason('current');
    setError('');
  }

  const sortedPlayers = useMemo(
    () =>
      data
        ? [...data.players].sort((a, b) =>
            String(a.name).localeCompare(
              String(b.name),
              'ja'
            )
          )
        : [],
    [data]
  );

  const seasons = useMemo(() => {
    if (!data?.tournaments?.length) return [];

    const max = Math.max(
      ...data.tournaments.map(
        (t) => Number(t.number) || 0
      )
    );

    const completed = Math.floor(max / 25);

    return Array.from(
      {
        length: completed,
      },
      (_, i) => ({
        key: String(i + 1),
        label: `シーズン${i + 1}`,
        from: i * 25 + 1,
        to: (i + 1) * 25,
      })
    );
  }, [data]);

  const tournamentTierScores = useMemo(
    () => calculateTournamentTierScores(data),
    [data]
  );

  const tournamentChampions = useMemo(() => {
    const recordsByTournament = new Map();

    for (const record of data?.records || []) {
      const number = Number(record.tournamentNumber);
      if (!Number.isFinite(number)) continue;
      if (!recordsByTournament.has(number)) recordsByTournament.set(number, []);
      recordsByTournament.get(number).push(record);
    }

    const playerNames = new Map(
      (data?.players || []).map((player) => [String(player.id), player.name])
    );
    const champions = new Map();

    for (const [number, records] of recordsByTournament) {
      const losers = new Set(records.map((record) => String(record.loserId)));
      const participants = new Set(
        records.flatMap((record) => [
          String(record.winnerId),
          String(record.loserId),
        ])
      );
      const unbeaten = [...participants].filter((id) => !losers.has(id));

      if (unbeaten.length === 1) {
        champions.set(number, playerNames.get(unbeaten[0]) || '');
      }
    }

    return champions;
  }, [data]);

  const maxTournament = data?.tournaments?.length
    ? Math.max(
        ...data.tournaments.map(
          (t) => Number(t.number) || 0
        )
      )
    : 0;

  const currentSeason = maxTournament > 0
    ? String(Math.floor(maxTournament / 25) + 1)
    : '1';

  const selectedSeason = season === 'current'
    ? currentSeason
    : season;

  const eloResult = useMemo(
    () => calculateElo(data, selectedSeason),
    [data, selectedSeason]
  );

  // Eloはここで1回だけ計算し、
  // ランキングはその最終結果を並べるだけにする。
  const ranking = eloResult.ranking;
  const matchHistory = eloResult.history;

  const selectedPlayer = data?.players.find(
    (player) =>
      String(player.id) === String(selected)
  );

  const selectedAchievements = useMemo(
    () => getPlayerAchievements(data, selected),
    [data, selected]
  );

  const opponentRows = useMemo(() => {
    if (!data || !selectedPlayer) return [];

    return data.players
      .filter(
        (player) =>
          String(player.id) !==
            String(selectedPlayer.id) &&
          data.stats?.[selectedPlayer.id]?.[player.id]
      )
      .map((player) => ({
        player,
        stat: data.stats[
          selectedPlayer.id
        ][player.id],
      }))
      .sort((a, b) => {
        if (sortKey === 'opponent') {
          const result =
            a.player.name.localeCompare(
              b.player.name,
              'ja'
            );

          return sortDir === 'asc'
            ? result
            : -result;
        }

        const av =
          sortKey === 'rate'
            ? a.stat.rate || 0
            : (a.stat.wins || 0) +
              (a.stat.losses || 0);

        const bv =
          sortKey === 'rate'
            ? b.stat.rate || 0
            : (b.stat.wins || 0) +
              (b.stat.losses || 0);

        return sortDir === 'asc'
          ? av - bv ||
              b.stat.wins - a.stat.wins
          : bv - av ||
              b.stat.wins - a.stat.wins;
      });
  }, [
    data,
    selectedPlayer,
    sortKey,
    sortDir,
  ]);

  const chartPlayerIds = selectedSeason === 'all' ? rateChartPlayers : rateChartPlayers.slice(0, 1);

  const ratingTrends = useMemo(() => {
    if (!chartPlayerIds.length) return [];
    return chartPlayerIds.map((rateChartPlayer, playerIndex) => {

    const startTournament =
      selectedSeason === 'all'
        ? 0
        : (Number(selectedSeason) - 1) * 25;
    const playerId = String(rateChartPlayer);
    const matchesByTournament = new Map();
    const playerMatches = [];

    for (const match of matchHistory) {
      const tournamentNumber = Number(match.tournamentNumber) || 0;
      if (!matchesByTournament.has(tournamentNumber)) {
        matchesByTournament.set(tournamentNumber, []);
      }
      matchesByTournament.get(tournamentNumber).push(match);

      const isWinner = String(match.winnerId) === playerId;
      const isLoser = String(match.loserId) === playerId;
      if (!isWinner && !isLoser) continue;

      const rating = isWinner ? match.winnerAfter : match.loserAfter;
      if (rating == null) continue;
      playerMatches.push({ tournamentNumber, rating, match });
    }

    const xMin = selectedSeason === 'all'
      ? 1
      : (Number(selectedSeason) - 1) * 25 + 1;
    const seasonRatings = playerMatches.filter(
      (point) =>
        selectedSeason === 'all' ||
        (point.tournamentNumber >= xMin && point.tournamentNumber < xMin + 25)
    );
    const hasSeasonParticipation = selectedSeason === 'all' || seasonRatings.length > 0;
    const previousRating = playerMatches
      .filter((point) => point.tournamentNumber < xMin)
      .at(-1)?.rating;
    const seasonEndTournament = selectedSeason === 'all'
      ? Math.max(xMin + 1, seasonRatings.at(-1)?.tournamentNumber ?? xMin)
      : xMin + 24;
    const points = [];
    let currentRating = previousRating ?? ELO_INITIAL_RATING;
    let matchCount = 0;

    const matchesInSeason = selectedSeason === 'all'
      ? playerMatches
      : seasonRatings;

    if (selectedSeason === 'all') {
      // 「すべて」は大会ごとの最終レートを描く。
      // 初参加大会から大会番号を横軸にし、不参加大会ではレートを維持する。
      const finalRatingByTournament = new Map();
      for (const point of playerMatches) {
        finalRatingByTournament.set(point.tournamentNumber, point.rating);
      }

      if (finalRatingByTournament.size > 0) {
        const firstPlayedTournament = Math.min(...finalRatingByTournament.keys());
        const lastTournament = Math.max(
          ...((data?.tournaments || []).map((t) => Number(t.number) || 0)),
          ...finalRatingByTournament.keys()
        );

        // 初参加の1大会前はレート1500。#1参加の場合は横軸0.5に仮の始点を置く。
        points.push({
          tournamentNumber: firstPlayedTournament - 1,
          xMatch: Math.max(0.5, firstPlayedTournament - 1),
          rating: ELO_INITIAL_RATING,
        });

        currentRating = ELO_INITIAL_RATING;
        for (
          let tournamentNumber = firstPlayedTournament;
          tournamentNumber <= lastTournament;
          tournamentNumber += 1
        ) {
          if (finalRatingByTournament.has(tournamentNumber)) {
            currentRating = finalRatingByTournament.get(tournamentNumber);
          }
          points.push({
            tournamentNumber,
            xMatch: tournamentNumber,
            rating: currentRating,
          });
        }
      }
    } else {
      // シーズン別は、シーズン開始時点から1試合ごとのレート推移を描く。
      points.push({ tournamentNumber: xMin, xMatch: 0, rating: currentRating });
      if (hasSeasonParticipation) {
        for (const point of matchesInSeason) {
          matchCount += 1;
          currentRating = point.rating;
          points.push({
            tournamentNumber: point.tournamentNumber,
            xMatch: matchCount,
            rating: currentRating,
          });
        }

        points.push({
          tournamentNumber: seasonEndTournament,
          xMatch: matchCount,
          rating: currentRating,
        });
      }
    }

    // 「すべて」は大会番号、「シーズン別」は対戦数を横軸の内部値にする。
    const yMin = 1100;
    const yMax = 2100;
    const xDomainMin = selectedSeason === 'all' ? 0.5 : 0;
    const sharedSeasonMatchCount = selectedSeason === 'all'
      ? 0
      : Math.max(0, ...chartPlayerIds.map((id) =>
          matchHistory.filter((match) =>
            (String(match.winnerId) === String(id) || String(match.loserId) === String(id)) &&
            (Number(match.tournamentNumber) || 0) >= xMin &&
            (Number(match.tournamentNumber) || 0) < xMin + 25
          ).length
        ));
    const xMax = selectedSeason === 'all'
      ? Math.max(2, ...points.map((point) => point.xMatch))
      : Math.max(1, sharedSeasonMatchCount);
    const width = 700;
    const height = 260;
    const margin = { top: 18, right: 18, bottom: 38, left: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const plottedPoints = points.map((point) => ({
      ...point,
      x: margin.left + ((point.xMatch - xDomainMin) / (xMax - xDomainMin)) * plotWidth,
      y: margin.top + ((yMax - point.rating) / (yMax - yMin)) * plotHeight,
    }));

    return {
      points: plottedPoints,
      hasSeasonParticipation,
      width,
      height,
      margin,
      plotWidth,
      plotHeight,
      yMin,
      yMax,
      xMin,
      xDomainMin,
      xMax,
      matchCount,
      matchesInSeason,
      tickStep: selectedSeason === 'all' ? 25 : 5,
      color: ['#b76bf0', '#35c9a5', '#ffb547', '#5da9ff', '#ff6b81'][playerIndex],
      player: data?.players.find(
        (player) => String(player.id) === String(rateChartPlayer)
      ),
    };
    });
  }, [matchHistory, chartPlayerIds, selectedSeason, data]);

  const ratingTrend = ratingTrends[0] || null;

  function toggleRateChartPlayer(playerId) {
    const id = String(playerId);
    if (selectedSeason !== 'all') {
      setRateChartPlayers((current) => current.slice(-1)[0] === id ? [] : [id]);
      return;
    }
    setRateChartPlayers((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 5) return current;
      return [...current, id];
    });
  }

  if (!data) {
    return (
      <main className="site">
        <div className="content">
          <section className="empty card">
            <div className="spinner" />

            <h2>
              {loading
                ? '人形劇のデータを確認しています'
                : '人形劇のデータを取得します'}
            </h2>

            <p>
              {loading
                ? '保存済みデータがあれば、それを表示したうえで未取得の大会だけ確認しています。'
                : '大会一覧とトーナメント表を取得します。'}
            </p>

            {!loading && (
              <button
                className="primary"
                onClick={() =>
                  loadLatest(null, true)
                }
              >
                データを取得
              </button>
            )}

            {error && (
              <p className="error">
                ⚠ {error}
              </p>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="site">
      <header className="hero">
        <div className="heroGlow" />

        <div className="heroInner">
          <div>
            <div className="eyebrow">
              NINGYOGEKI / TOURNAMENT STATS
            </div>

            <h1>
              人形劇 <span>戦績表</span>
            </h1>

            <p>
              人形劇全体の直接対戦成績をまとめて確認できます。
            </p>
          </div>
        </div>
      </header>

      <div className="content">

        {error && (
          <div className="error card">
            ⚠ {error}
          </div>
        )}

        <section className="statsGrid">
          <div className="stat card">
            <span>取得大会</span>
            <strong>
              {data.tournaments.length}
            </strong>
            <small>tournaments</small>
          </div>

          <div className="stat card">
            <span>参加人数</span>
            <strong>
              {data.players.length}
            </strong>
            <small>players</small>
          </div>

          <div className="stat card">
            <span>総対戦数</span>
            <strong>{data.matches}</strong>
            <small>matches</small>
          </div>
        </section>

        <section className="card matrixCard">
          <div className="sectionHead">
            <div>
              <div className="sectionLabel">
                PLAYER VIEW
              </div>

              <h2>対戦表</h2>

              <p>
                最初は全員分。名前を選ぶと、その選手視点の戦績に切り替わります。
              </p>
            </div>
          </div>

          <div className="playerSelectWrap">
            <label htmlFor="playerSelect">
              表示する選手
            </label>

            <select
              id="playerSelect"
              value={selected}
              onChange={(e) =>
                setSelected(e.target.value)
              }
            >
              <option value="all">
                全体（全選手）
              </option>

              {sortedPlayers.map((player) => (
                <option
                  key={player.id}
                  value={player.id}
                >
                  {player.name}
                </option>
              ))}
            </select>
          </div>

          {selected !== 'all' && selectedPlayer && (
            <div className="achievementPanel">
              <div className="achievementItem titleItem">
                <span>優勝した大会（全期間）</span>
                {selectedAchievements.titleNumbers.length ? (
                  <div className="achievementTournaments">
                    {selectedAchievements.titleNumbers.map((number) => {
                      const score = Number(tournamentTierScores[Number(number)] || 0);
                      const tier = score >= 24000 ? 'S' : score >= 20000 ? 'A' : score >= 16000 ? 'B' : score >= 12000 ? 'C' : 'D';
                      return (
                        <span className="achievementTournament" key={number}>
                          <b className={`achievementTier tier${tier}`}>{tier}</b>
                          <span>人形劇#{number}</span>
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <strong>優勝記録なし</strong>
                )}
              </div>
              <div className="achievementItem">
                <span>勝率</span>
                <strong>{selectedAchievements.matchWinRate}%</strong>
                <small>{selectedAchievements.matchWins}勝 / {selectedAchievements.matchCount}戦</small>
              </div>
              <div className="achievementItem">
                <span>大会優勝率</span>
                <strong>{selectedAchievements.tournamentWinRate}%</strong>
                <small>{selectedAchievements.tournamentWins}優勝 / {selectedAchievements.tournamentCount}大会</small>
              </div>
              <div className="achievementItem streakItem">
                <span>最大連覇</span>
                <strong>{selectedAchievements.streak}連覇</strong>
              </div>
            </div>
          )}

          {selected === 'all' ? (
            <div className="matrixWrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>PLAYER</th>

                    {sortedPlayers.map(
                      (player) => (
                        <th key={player.id}>
                          {player.name}
                        </th>
                      )
                    )}
                  </tr>
                </thead>

                <tbody>
                  {sortedPlayers.map((row) => (
                    <tr key={row.id}>
                      <th>{row.name}</th>

                      {sortedPlayers.map(
                        (col) => {
                          const stat =
                            data.stats?.[
                              row.id
                            ]?.[col.id];

                          return (
                            <td
                              key={col.id}
                              className={
                                row.id === col.id
                                  ? 'self'
                                  : stat
                                  ? 'hasData'
                                  : ''
                              }
                            >
                              {row.id ===
                              col.id ? (
                                '—'
                              ) : stat ? (
                                <>
                                  <strong>
                                    {rate(stat)}
                                  </strong>

                                  <small>
                                    {stat.wins}-
                                    {stat.losses}
                                  </small>
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        }
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="playerTableWrap">
              <table className="playerTable">
                <colgroup>
                  <col className="opponentCol" />
                  <col className="rateCol" />
                  <col className="recordCol" />
                  <col className="matchesCol" />
                </colgroup>

                <thead>
                  <tr>
                    <th>
                      <button
                        className="sortButton"
                        onClick={() =>
                          toggleSort('opponent')
                        }
                      >
                        対戦相手
                        {sortMark('opponent')}
                      </button>
                    </th>

                    <th>
                      <button
                        className="sortButton"
                        onClick={() =>
                          toggleSort('rate')
                        }
                      >
                        勝率
                        {sortMark('rate')}
                      </button>
                    </th>

                    <th>戦績</th>

                    <th>
                      <button
                        className="sortButton"
                        onClick={() =>
                          toggleSort('matches')
                        }
                      >
                        対戦数
                        {sortMark('matches')}
                      </button>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {opponentRows.map(
                    ({ player, stat }) => (
                      <tr key={player.id}>
                        <td className="opponentName">
                          {player.name}
                        </td>

                        <td>
                          <strong>
                            {stat.rate}%
                          </strong>
                        </td>

                        <td className="recordCell">
                          <div className="recordSummary">
                            <span className="recordWin">
                              {stat.wins}勝
                            </span>{' '}
                            <span className="recordLoss">
                              {stat.losses}敗
                            </span>
                          </div>

                          <div className="recentResults">
                            {getRecentResults(
                              data.records,
                              selectedPlayer.id,
                              player.id
                            ).map((result, index) => (
                              <div
                                key={`${player.id}-${result.tournamentNumber}-${index}`}
                                className={`recentResult ${
                                  result.result === 'W'
                                    ? 'win'
                                    : 'loss'
                                } ${
                                  index === 0 ? 'latest' : ''
                                }`}
                              >
                                {result.result}
                              </div>
                            ))}
                          </div>
                        </td>

                        <td>
                          {stat.wins +
                            stat.losses}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="sectionHead">
            <div>
              <div className="sectionLabel">
                SEASON ELO
              </div>

              <h2>
                シーズンEloランキング
              </h2>

              <p>
                25大会ごとにシーズンを区切り、Eloでレートを算出します。Eloは各シーズン1500から開始し、1試合ごとに更新します。RDはシーズンをまたいで引き継ぎ、長期間プレイしていない場合は経過期間に応じて増加します。相手のRDが自分より高い場合、シーズン別ランキングではRD差200以上で勝利時の獲得量を最大1.5倍にし、敗北時の減少量はRD差に応じて最大0.25倍に抑えます。「すべて」のランキングではRD差による勝利ボーナスを適用しません。
              </p>
            </div>

          </div>

          <div className="seasonTabs">
            <button
              className={
                season === 'current' ? 'active' : ''
              }
              onClick={() =>
                setSeason('current')
              }
            >
              現在
            </button>

            <button
              className={
                season === 'all' ? 'active' : ''
              }
              onClick={() =>
                setSeason('all')
              }
            >
              すべて
            </button>

            {seasons.map((s) => (
              <button
                key={s.key}
                className={
                  season === s.key
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSeason(s.key)
                }
              >
                {s.label}
              </button>
            ))}
          </div>

          {ratingTrends.length > 0 && (
            <section className="ratingTrend" aria-label="選手のレート推移">
              <div className="ratingTrendHead">
                <div>
                  <div className="sectionLabel">RATING HISTORY</div>
                  <h3>{selectedSeason === 'all' ? `選手のレート推移（${ratingTrends.length}/5人）` : `${ratingTrend.player?.name || '選手'}のレート推移`}</h3>
                  <p>
                    {selectedSeason === 'all' ? '全期間' : `シーズン${selectedSeason}`}
                    {' '}・{selectedSeason === 'all' ? '大会ごとの最終レート' : '対戦ごとのレート推移'}
                  </p>
                </div>
                <button
                  type="button"
                  className="trendClose"
                  onClick={() => setRateChartPlayers([])}
                  aria-label="レート推移を閉じる"
                >
                  グラフを閉じる ×
                </button>
              </div>
              {selectedSeason === 'all' && <div className="trendLegend">
                {ratingTrends.map((trend) => (
                  <span key={trend.player?.id} className="trendLegendItem" style={{ color: trend.color }}>
                    <i style={{ backgroundColor: trend.color }} />
                    {trend.player?.name || '選手'}
                    <button type="button" onClick={() => toggleRateChartPlayer(trend.player?.id)} aria-label={`${trend.player?.name}をグラフから外す`}>×</button>
                  </span>
                ))}
              </div>}
              <div className="ratingTrendChart">
                <svg
                  viewBox={`0 0 ${ratingTrend.width} ${ratingTrend.height}`}
                  role="img"
                  aria-label={`選択した${ratingTrends.length}人のレート推移グラフ`}
                >
                  {[0, 1, 2, 3, 4, 5].map((tick) => {
                    const rating = ratingTrend.yMax -
                      ((ratingTrend.yMax - ratingTrend.yMin) * tick) / 5;
                    const y = ratingTrend.margin.top +
                      (ratingTrend.plotHeight * tick) / 5;
                    return (
                      <g key={tick}>
                        <line
                          x1={ratingTrend.margin.left}
                          x2={ratingTrend.width - ratingTrend.margin.right}
                          y1={y}
                          y2={y}
                          className="trendGridLine"
                        />
                        <text
                          x={ratingTrend.margin.left - 10}
                          y={y + 4}
                          textAnchor="end"
                          className="trendAxisLabel"
                        >
                          {Math.round(rating)}
                        </text>
                      </g>
                    );
                  })}
                  <line
                    x1={ratingTrend.margin.left}
                    x2={ratingTrend.width - ratingTrend.margin.right}
                    y1={ratingTrend.height - ratingTrend.margin.bottom}
                    y2={ratingTrend.height - ratingTrend.margin.bottom}
                    className="trendAxisLine"
                  />
                  {ratingTrends.map((trend) => trend.hasSeasonParticipation && (
                    <polyline
                      key={trend.player?.id}
                      points={trend.points.map((point) => `${point.x},${point.y}`).join(' ')}
                      fill="none"
                      stroke={trend.color}
                      strokeWidth="3"
                      strokeLinejoin="round"
                    />
                  ))}
                  {(() => {
                    const ticks = [];
                    const tickStep = ratingTrend.tickStep;
                    const lastTournament = selectedSeason === 'all'
                      ? ratingTrend.xMax
                      : ratingTrend.xMin + 24;
                    for (
                      let tournamentNumber = selectedSeason === 'all' ? 1 : ratingTrend.xMin;
                      tournamentNumber <= lastTournament;
                      tournamentNumber += tickStep
                    ) {
                      const matchesBeforeTick = ratingTrend.matchesInSeason.filter(
                        (point) => point.tournamentNumber < tournamentNumber
                      ).length;
                      ticks.push({
                        tournamentNumber,
                        xMatch: selectedSeason === 'all'
                          ? tournamentNumber
                          : ratingTrend.hasSeasonParticipation
                            ? matchesBeforeTick
                            : ((tournamentNumber - ratingTrend.xMin) / Math.max(1, lastTournament - ratingTrend.xMin)) * ratingTrend.xMax,
                      });
                    }
                    if (selectedSeason !== 'all') {
                      ticks.push({
                        tournamentNumber: ratingTrend.xMin + 24,
                        xMatch: ratingTrend.xMax,
                      });
                    }
                    const distinctTicks = new Map();
                    for (const tick of ticks) distinctTicks.set(tick.xMatch, tick);
                    return [...distinctTicks.values()].map(({ tournamentNumber, xMatch }) => {
                      const x = ratingTrend.margin.left +
                        ((xMatch - ratingTrend.xDomainMin) / (ratingTrend.xMax - ratingTrend.xDomainMin)) *
                        ratingTrend.plotWidth;
                      return (
                        <text
                          key={tournamentNumber}
                          x={x}
                          y={ratingTrend.height - 12}
                          textAnchor={xMatch === 0 ? 'start' : 'middle'}
                          className="trendAxisLabel"
                        >
                          {tournamentNumber}
                        </text>
                      );
                    });
                  })()}
                </svg>
              </div>
            </section>
          )}

          {selectedSeason === 'all' && <p className="chartSelectHint">ランキングの選手名をタップしてグラフに追加（最大5人）。もう一度タップすると解除できます。</p>}
          <div className="rankingList">
            {ranking.map(
              (player, index) => (
                <div
                  className="rankRow"
                  key={player.id}
                >
                  <div className="rankNo">
                    {String(index + 1).padStart(
                      2,
                      '0'
                    )}
                  </div>

                  <button
                    type="button"
                    className={`rankName rankNameButton ${chartPlayerIds.includes(String(player.id)) ? 'selected' : ''}`}
                    onClick={() => toggleRateChartPlayer(player.id)}
                    aria-pressed={rateChartPlayers.includes(String(player.id))}
                    title={rateChartPlayers.includes(String(player.id)) ? `${player.name}をグラフから外す` : rateChartPlayers.length >= 5 ? '最大5人まで選択できます' : `${player.name}のレート推移を追加`}
                  >
                    {player.name}
                  </button>

                  <div className="bar">
                    <i
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            ((player.rating - 1000) / 1000) * 100
                          )
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="rankRate">
                    {player.rating}
                  </div>

                  <div className="record">
                    {player.wins}勝 {player.losses}敗 / {player.total}戦
                  </div>
                </div>
              )
            )}
          </div>
        </section>

        <section className="card matchesCard">
          <button
            className="collapse"
            onClick={() =>
              setShow(!show)
            }
          >
            {show ? '▼' : '▶'} 全対戦履歴{' '}
            <span>
              {matchHistory.length} MATCHES
            </span>
          </button>

          {show && (
            <div className="matchList">
              {matchHistory.slice().reverse().map(
                (match, index) => (
                  <div
                    className="match"
                    key={`${match.tournamentNumber}-${match.winnerId}-${match.loserId}-${index}`}
                  >
                    <span className="round">
                      #{match.tournamentNumber}
                    </span>

                    <span className="winner">
                      <strong>{match.winner}</strong>
                      {match.winnerBefore != null && (
                        <small className="matchMeta">
                          <span className="matchRd">
                            RD {match.winnerRd}
                          </span>
                          <span className="ratingChange">
                            {match.winnerBefore} → {match.winnerAfter}{' '}
                            <i className={match.winnerDelta >= 0 ? 'up' : 'down'}>
                              ({match.winnerDelta >= 0 ? '+' : ''}{match.winnerDelta})
                            </i>
                          </span>
                        </small>
                      )}
                    </span>

                    <b>WIN</b>

                    <span className="loser">
                      <strong>{match.loser}</strong>
                      {match.loserBefore != null && (
                        <small className="matchMeta">
                          <span className="matchRd">
                            RD {match.loserRd}
                          </span>
                          <span className="ratingChange">
                            {match.loserBefore} → {match.loserAfter}{' '}
                            <i className={match.loserDelta >= 0 ? 'up' : 'down'}>
                              ({match.loserDelta >= 0 ? '+' : ''}{match.loserDelta})
                            </i>
                          </span>
                        </small>
                      )}
                    </span>
                  </div>
                )
              )}
            </div>
          )}
        </section>


        <section className="card">
          <div className="sectionHead">
            <div>
              <div className="sectionLabel">
                TOURNAMENTS
              </div>

              <h2>取得した人形劇</h2>
            </div>

            <span className="badge">
              {data.tournaments.length}
            </span>
          </div>

          <div className="tournamentList">
            {data.tournaments
              .slice()
              .reverse()
              .map((tournament) => (
                <div className="tournamentRow" key={tournament.number}>
                  <a
                    className="tournamentTitle"
                    href={tournament.bracketUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <b>
                      人形劇#
                      {tournament.number}
                    </b>
                    <small className="tournamentTier">
                      {(() => {
                        const score = Number(tournamentTierScores[Number(tournament.number)] || 0);
                        const tier = score >= 24000 ? 'S' : score >= 20000 ? 'A' : score >= 16000 ? 'B' : score >= 12000 ? 'C' : 'D';
                        return (
                          <>
                            <span className={`tierBadge tier${tier}`}>{tier}</span>
                            <span>{score.toLocaleString('ja-JP')}</span>
                          </>
                        );
                      })()}
                    </small>
                    {tournamentChampions.get(Number(tournament.number)) && (
                      <small className="tournamentChampion">
                        {tournamentChampions.get(Number(tournament.number))}
                      </small>
                    )}
                  </a>

                  <span className="tournamentMeta">
                    {tournament.players}人 /{' '}
                    {tournament.matches}試合
                  </span>
                </div>
              ))}
          </div>
        </section>

        {/* 全対戦履歴の下 */}
        <section className="control card" style={{ marginTop: '18px' }}>
          <div>
            <h2>人形劇全体を集計</h2>

            <p>
              ページを開くたびに大会一覧だけを確認し、まだ読み込んでいない大会がある場合だけ取得します。
            </p>
          </div>

          <div className="buttonGroup">
            <button
              className="primary"
              onClick={() => loadLatest()}
              disabled={loading}
            >
              {loading
                ? '未取得大会を確認中…'
                : '最新データを確認'}
            </button>

            <button
              className="secondary"
              onClick={resetData}
              disabled={loading}
            >
              保存データをリセット
            </button>
          </div>

          <div className="hint">
            {loading
              ? '既存の大会は再取得しません。'
              : '未取得の大会がある場合だけ追加で読み込みます。'}
          </div>
        </section>

        <footer>
          NINGYOGEKI STATS <span>—</span>{' '}
          Smashmate tournament results
        </footer>
      </div>
    </main>
  );
}
