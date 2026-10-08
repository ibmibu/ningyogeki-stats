'use client';

import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ningyogeki-stats-v4';

function rate(stat) {
  return stat ? `${stat.rate}%` : '—';
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

const GLICKO2_SCALE = 173.7178;
const GLICKO2_TAU = 0.5;
const GLICKO2_INITIAL_RATING = 1500;
const GLICKO2_INITIAL_RD = 350;
const GLICKO2_INITIAL_VOLATILITY = 0.06;

function glicko2G(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function glicko2Expected(mu, opponentMu, opponentPhi) {
  return 1 / (1 + Math.exp(-glicko2G(opponentPhi) * (mu - opponentMu)));
}

function glicko2F(x, delta, phi, v, a) {
  const ex = Math.exp(x);
  return (
    (ex * (delta * delta - phi * phi - v - ex)) /
      (2 * Math.pow(phi * phi + v + ex, 2)) -
    (x - a) / (GLICKO2_TAU * GLICKO2_TAU)
  );
}

function updateGlicko2Player(player, results) {
  const mu = (player.rating - GLICKO2_INITIAL_RATING) / GLICKO2_SCALE;
  const phi = player.rd / GLICKO2_SCALE;
  const sigma = player.volatility;

  if (!results.length) {
    const phiPrime = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: Math.min(GLICKO2_INITIAL_RD, GLICKO2_SCALE * phiPrime), volatility: sigma };
  }

  let sumG2E1E = 0;
  let sumGScoreMinusE = 0;
  for (const result of results) {
    const opponentMu = (result.opponent.rating - GLICKO2_INITIAL_RATING) / GLICKO2_SCALE;
    const opponentPhi = result.opponent.rd / GLICKO2_SCALE;
    const g = glicko2G(opponentPhi);
    const e = glicko2Expected(mu, opponentMu, opponentPhi);
    sumG2E1E += g * g * e * (1 - e);
    sumGScoreMinusE += g * (result.score - e);
  }

  const v = 1 / sumG2E1E;
  const delta = v * sumGScoreMinusE;
  const a = Math.log(sigma * sigma);
  let A = a;
  let B;

  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (glicko2F(a - k * GLICKO2_TAU, delta, phi, v, a) < 0) k += 1;
    B = a - k * GLICKO2_TAU;
  }

  let fA = glicko2F(A, delta, phi, v, a);
  let fB = glicko2F(B, delta, phi, v, a);
  for (let i = 0; i < 100 && Math.abs(B - A) > 0.000001; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = glicko2F(C, delta, phi, v, a);
    if (fC * fB < 0) { A = B; fA = fB; } else { fA /= 2; }
    B = C;
    fB = fC;
  }

  const newSigma = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * sumGScoreMinusE;
  return {
    rating: GLICKO2_INITIAL_RATING + GLICKO2_SCALE * newMu,
    rd: Math.min(GLICKO2_INITIAL_RD, GLICKO2_SCALE * newPhi),
    volatility: newSigma,
  };
}

function calculateGlicko2Ranking(data, season) {
  if (!data?.records?.length) return [];
  const records = season === 'all' ? data.records : data.records.filter((record) => {
    const n = Number(record.tournamentNumber) || 0;
    const s = Number(season);
    return n >= (s - 1) * 25 + 1 && n <= s * 25;
  });
  const tournamentNumbers = [...new Set(records.map((r) => Number(r.tournamentNumber)).filter(Number.isFinite))].sort((a, b) => a - b);
  const players = new Map();
  for (const player of data.players) players.set(String(player.id), { id: player.id, name: player.name, rating: 1500, rd: 350, volatility: 0.06, wins: 0, losses: 0 });

  for (const tournamentNumber of tournamentNumbers) {
    const tournamentRecords = records.filter((r) => Number(r.tournamentNumber) === tournamentNumber);
    const resultsByPlayer = new Map();
    for (const record of tournamentRecords) {
      const winner = players.get(String(record.winnerId));
      const loser = players.get(String(record.loserId));
      if (!winner || !loser) continue;
      if (!resultsByPlayer.has(String(winner.id))) resultsByPlayer.set(String(winner.id), []);
      if (!resultsByPlayer.has(String(loser.id))) resultsByPlayer.set(String(loser.id), []);
      resultsByPlayer.get(String(winner.id)).push({ opponent: { rating: loser.rating, rd: loser.rd }, score: 1 });
      resultsByPlayer.get(String(loser.id)).push({ opponent: { rating: winner.rating, rd: winner.rd }, score: 0 });
      winner.wins += 1;
      loser.losses += 1;
    }
    const updated = new Map();
    for (const [playerId, results] of resultsByPlayer) updated.set(playerId, updateGlicko2Player(players.get(playerId), results));
    for (const [playerId, next] of updated) {
      const player = players.get(playerId);
      player.rating = next.rating;
      player.rd = next.rd;
      player.volatility = next.volatility;
    }
  }

  return [...players.values()].filter((p) => p.wins + p.losses > 0).map((p) => ({ ...p, rating: Math.round(p.rating), rd: Math.round(p.rd), total: p.wins + p.losses })).sort((a, b) => b.rating - a.rating || a.rd - b.rd || b.total - a.total || String(a.name).localeCompare(String(b.name), 'ja'));
}


function calculateMatchRatingChanges(data) {
  if (!data?.records?.length) return [];

  const playerStates = new Map();

  for (const player of data.players || []) {
    playerStates.set(String(player.id), {
      rating: GLICKO2_INITIAL_RATING,
      rd: GLICKO2_INITIAL_RD,
      volatility: GLICKO2_INITIAL_VOLATILITY,
    });
  }

  const sortedRecords = [...data.records].sort(
    (a, b) =>
      (Number(a.tournamentNumber) || 0) -
      (Number(b.tournamentNumber) || 0)
  );

  return sortedRecords.map((record) => {
    const winner = playerStates.get(String(record.winnerId));
    const loser = playerStates.get(String(record.loserId));

    if (!winner || !loser) {
      return {
        ...record,
        winnerBefore: null,
        winnerAfter: null,
        winnerDelta: null,
        loserBefore: null,
        loserAfter: null,
        loserDelta: null,
      };
    }

    const winnerBefore = Math.round(winner.rating);
    const loserBefore = Math.round(loser.rating);

    const winnerAfterState = updateGlicko2Player(winner, [
      {
        opponent: { rating: loser.rating, rd: loser.rd },
        score: 1,
      },
    ]);

    const loserAfterState = updateGlicko2Player(loser, [
      {
        opponent: { rating: winner.rating, rd: winner.rd },
        score: 0,
      },
    ]);

    winner.rating = winnerAfterState.rating;
    winner.rd = winnerAfterState.rd;
    winner.volatility = winnerAfterState.volatility;

    loser.rating = loserAfterState.rating;
    loser.rd = loserAfterState.rd;
    loser.volatility = loserAfterState.volatility;

    const winnerAfter = Math.round(winner.rating);
    const loserAfter = Math.round(loser.rating);

    return {
      ...record,
      winnerBefore,
      winnerAfter,
      winnerDelta: winnerAfter - winnerBefore,
      loserBefore,
      loserAfter,
      loserDelta: loserAfter - loserBefore,
    };
  });
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

    return Array.from(
      {
        length: Math.ceil(max / 25),
      },
      (_, i) => ({
        key: String(i + 1),
        label: `シーズン${i + 1}`,
        from: i * 25 + 1,
        to: (i + 1) * 25,
      })
    );
  }, [data]);

  const currentSeason = seasons.length
    ? seasons[seasons.length - 1].key
    : 'all';

  const selectedSeason = season === 'current'
    ? currentSeason
    : season;

  const ranking = useMemo(
    () => calculateGlicko2Ranking(data, selectedSeason),
    [data, selectedSeason]
  );

  const selectedPlayer = data?.players.find(
    (player) =>
      String(player.id) === String(selected)
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
                SEASON GLICKO-2
              </div>

              <h2>
                シーズンGlicko-2ランキング
              </h2>

              <p>
                25大会ごとにシーズンを区切り、Glicko-2でレートを算出します。各シーズンは1500から開始します。
              </p>
            </div>

            <span className="badge">
              GLICKO-2
            </span>
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

                  <div className="rankName">
                    {player.name}
                  </div>

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
                    ±{player.rd} / {player.wins}勝{' '}
                    {player.losses}敗 /{' '}
                    {player.total}戦
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
              {data.records.length} MATCHES
            </span>
          </button>

          {show && (
            <div className="matchList">
              {calculateMatchRatingChanges(data).slice().reverse().map(
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
                        <small className="ratingChange">
                          {match.winnerBefore} → {match.winnerAfter}{' '}
                          <i className={match.winnerDelta >= 0 ? 'up' : 'down'}>
                            ({match.winnerDelta >= 0 ? '+' : ''}{match.winnerDelta})
                          </i>
                        </small>
                      )}
                    </span>

                    <b>WIN</b>

                    <span className="loser">
                      <strong>{match.loser}</strong>
                      {match.loserBefore != null && (
                        <small className="ratingChange">
                          {match.loserBefore} → {match.loserAfter}{' '}
                          <i className={match.loserDelta >= 0 ? 'up' : 'down'}>
                            ({match.loserDelta >= 0 ? '+' : ''}{match.loserDelta})
                          </i>
                        </small>
                      )}
                    </span>
                  </div>
                )
              )}
            </div>
          )}
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
                <a
                  key={tournament.number}
                  href={tournament.bracketUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <b>
                    人形劇#
                    {tournament.number}
                  </b>

                  <span>
                    {tournament.players}人 /{' '}
                    {tournament.matches}試合
                  </span>

                  <em>↗</em>
                </a>
              ))}
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
