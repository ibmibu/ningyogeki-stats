// レーティング計算を画面コンポーネントから分離する。
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

export function calculateElo(data, season = 'all') {
  if (!data?.records?.length) {
    return { ranking: [], history: [] };
  }

  const allRecords = [...data.records].sort(
    (a, b) =>
      (Number(a.tournamentNumber) || 0) -
      (Number(b.tournamentNumber) || 0)
  );

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
  const seasonEnd = seasonNumber * 25;
  const priorRecords = [];
  const seasonRecords = [];

  // 1回の走査で、RD引き継ぎ用の過去大会と選択シーズンを分ける。
  // allRecordsは大会番号順なので、それぞれの処理順は従来どおり。
  for (const record of allRecords) {
    const tournamentNumber =
      Number(record.tournamentNumber) || 0;

    if (tournamentNumber < seasonStart) {
      priorRecords.push(record);
    } else if (tournamentNumber <= seasonEnd) {
      seasonRecords.push(record);
    }
  }

  // Eloだけを選択シーズン開始時に1500へリセットする。
  // RDはそれ以前の全試合から引き継ぐ。
  updateRdOnly(players, priorRecords);

  const history = processRecords(
    players,
    seasonRecords,
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

export function calculateTournamentTierScores(data, getEloResult = (season) => calculateElo(data, season)) {
  const tournaments = Array.isArray(data?.tournaments) ? data.tournaments : [];
  const records = Array.isArray(data?.records) ? data.records : [];
  if (!tournaments.length || !records.length) return {};

  const maxTournamentNumber = Math.max(
    ...tournaments.map((tournament) => Number(tournament.number) || 0)
  );
  const seasonRatingsCache = new Map();

  // 大会規模は「その大会が属するシーズン」のレートで算出する。
  // 終了済みシーズンは最終レート、開催中シーズンは最新レートを全大会に適用する。
  // 「すべて」のランキングのレートは大会規模の計算には使用しない。
  const getSeasonFinalRatings = (seasonNumber) => {
    if (seasonRatingsCache.has(seasonNumber)) {
      return seasonRatingsCache.get(seasonNumber);
    }

    const result = getEloResult(String(seasonNumber));
    const ratings = new Map(
      result.ranking.map((player) => [
        String(player.id),
        Number(player.rating) || ELO_INITIAL_RATING,
      ])
    );
    seasonRatingsCache.set(seasonNumber, ratings);
    return ratings;
  };

  const participantsByTournament = new Map();
  for (const record of records) {
    const tournamentNumber = Number(record.tournamentNumber) || 0;
    if (!tournamentNumber) continue;
    if (!participantsByTournament.has(tournamentNumber)) {
      participantsByTournament.set(tournamentNumber, new Set());
    }
    const participants = participantsByTournament.get(tournamentNumber);
    if (record.winnerId != null) participants.add(String(record.winnerId));
    if (record.loserId != null) participants.add(String(record.loserId));
  }

  const scores = {};
  for (const tournament of tournaments) {
    const tournamentNumber = Number(tournament.number) || 0;
    if (!tournamentNumber) continue;

    const seasonNumber = Math.floor((tournamentNumber - 1) / 25) + 1;
    const positionInSeason = ((tournamentNumber - 1) % 25) + 1;
    // シーズン最初の5大会は前シーズンの最終レートで規模を算出する。
    // それ以降は、その大会が属するシーズンのレートを使う。
    const ratingSeason =
      seasonNumber > 1 && positionInSeason <= 5
        ? seasonNumber - 1
        : seasonNumber;
    const ratings = getSeasonFinalRatings(ratingSeason);
    const participants = participantsByTournament.get(tournamentNumber) || new Set();

    let total = 0;
    for (const playerId of participants) {
      total += ratings.get(playerId) ?? ELO_INITIAL_RATING;
    }
    scores[tournamentNumber] = Math.round(total);
  }

  return scores;
}
