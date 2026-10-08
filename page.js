'use client';

import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ningyogeki-stats-v4';

/* =========================================================
   Data helpers
========================================================= */

function mergeStats(base = {}, added = {}) {
  const result = structuredClone(base || {});

  for (const [playerId, opponents] of Object.entries(added || {})) {
    result[playerId] ??= {};

    for (const [opponentId, stat] of Object.entries(opponents || {})) {
      result[playerId][opponentId] ??= {
        wins: 0,
        losses: 0,
      };

      result[playerId][opponentId].wins += Number(
        stat.wins || 0
      );

      result[playerId][opponentId].losses += Number(
        stat.losses || 0
      );

      const total =
        result[playerId][opponentId].wins +
        result[playerId][opponentId].losses;

      result[playerId][opponentId].rate = total
        ? Math.round(
            (result[playerId][opponentId].wins / total) *
              1000
          ) / 10
        : 0;
    }
  }

  return result;
}

function getTournamentNumber(record) {
  return Number(
    record?.tournamentNumber ??
      record?.tournament_number ??
      record?.tournament ??
      0
  );
}

function getPlayerId(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === 'object') {
    return (
      value.id ??
      value.playerId ??
      value.player_id ??
      null
    );
  }

  return value;
}

function getWinnerId(record) {
  return getPlayerId(
    record?.winnerId ??
      record?.winner_id ??
      record?.winnerPlayer ??
      record?.winner_player
  );
}

function getLoserId(record) {
  return getPlayerId(
    record?.loserId ??
      record?.loser_id ??
      record?.loserPlayer ??
      record?.loser_player
  );
}

function getLastTournament(data) {
  if (!data?.tournaments?.length) {
    return 0;
  }

  return Math.max(
    ...data.tournaments.map((tournament) =>
      Number(tournament.number || 0)
    )
  );
}

function getSeason(number) {
  if (!number) {
    return 1;
  }

  return Math.floor((Number(number) - 1) / 25) + 1;
}

/* =========================================================
   Records
========================================================= */

function mergeRecords(
  oldRecords = [],
  newRecords = []
) {
  const map = new Map();

  const add = (record, index) => {
    const winnerId = getWinnerId(record);
    const loserId = getLoserId(record);
    const tournamentNumber =
      getTournamentNumber(record);

    if (
      winnerId == null ||
      loserId == null ||
      !tournamentNumber
    ) {
      return;
    }

    /*
     * 同じ大会・同じ勝敗の記録が重複していた場合だけ
     * まとめる。
     *
     * matchIndex がAPI側にあれば、それもキーに使う。
     */
    const matchIndex =
      record?.matchIndex ??
      record?.match_index ??
      index;

    const key = [
      tournamentNumber,
      String(winnerId),
      String(loserId),
      String(matchIndex),
    ].join('|');

    map.set(key, {
      ...record,
      tournamentNumber,
      winnerId,
      loserId,
    });
  };

  oldRecords.forEach(add);
  newRecords.forEach(add);

  return [...map.values()].sort(
    (a, b) =>
      getTournamentNumber(b) -
      getTournamentNumber(a)
  );
}

/* =========================================================
   Merge whole dataset
========================================================= */

function mergeData(oldData, newData) {
  if (!oldData) {
    return {
      ...newData,
      records: mergeRecords(
        [],
        newData?.records || []
      ),
      matches:
        newData?.records?.length ||
        newData?.matches ||
        0,
    };
  }

  const playerMap = new Map();

  for (const player of oldData.players || []) {
    playerMap.set(String(player.id), player);
  }

  for (const player of newData.players || []) {
    playerMap.set(String(player.id), player);
  }

  const tournamentMap = new Map();

  for (const tournament of oldData.tournaments || []) {
    tournamentMap.set(
      Number(tournament.number),
      tournament
    );
  }

  for (const tournament of newData.tournaments || []) {
    tournamentMap.set(
      Number(tournament.number),
      tournament
    );
  }

  const tournaments = [
    ...tournamentMap.values(),
  ].sort(
    (a, b) =>
      Number(a.number) - Number(b.number)
  );

  const records = mergeRecords(
    oldData.records || [],
    newData.records || []
  );

  return {
    ...oldData,
    ...newData,

    players: [...playerMap.values()],

    tournaments,

    records,

    stats: mergeStats(
      oldData.stats,
      newData.stats
    ),

    matches: records.length,

    failed: newData.failed || [],
  };
}

/* =========================================================
   Recent 5 results
========================================================= */

function getRecentResults(
  records,
  playerId,
  opponentId
) {
  if (!Array.isArray(records)) {
    return [];
  }

  const player = String(playerId);
  const opponent = String(opponentId);

  return records
    .map((record, index) => ({
      record,
      index,
    }))
    .filter(({ record }) => {
      const winnerId = getWinnerId(record);
      const loserId = getLoserId(record);

      if (
        winnerId == null ||
        loserId == null
      ) {
        return false;
      }

      const winner = String(winnerId);
      const loser = String(loserId);

      return (
        (winner === player &&
          loser === opponent) ||
        (winner === opponent &&
          loser === player)
      );
    })
    .sort((a, b) => {
      const tournamentDiff =
        getTournamentNumber(b.record) -
        getTournamentNumber(a.record);

      if (tournamentDiff !== 0) {
        return tournamentDiff;
      }

      /*
       * 同じ大会内なら、recordsに入っている
       * 後ろ側を新しいものとして扱う。
       */
      return b.index - a.index;
    })
    .slice(0, 5)
    .map(({ record }) => {
      const winnerId = getWinnerId(record);

      return {
        result:
          String(winnerId) === player
            ? 'W'
            : 'L',

        tournamentNumber:
          getTournamentNumber(record),
      };
    });
}

/* =========================================================
   Component
========================================================= */

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] =
    useState(false);

  const [selected, setSelected] =
    useState('all');

  const [sortKey, setSortKey] =
    useState('rate');

  const [season, setSeason] =
    useState('all');

  const [loaded, setLoaded] =
    useState(false);

  /* =======================================================
     Load localStorage
  ======================================================= */

  useEffect(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const parsed =
          JSON.parse(saved);

        if (
          parsed?.players &&
          parsed?.stats
        ) {
          setData(parsed);
        }
      }
    } catch (e) {
      console.error(
        '保存データの読み込みに失敗しました',
        e
      );
    }

    setLoaded(true);
  }, []);

  /* =======================================================
     Save localStorage
  ======================================================= */

  useEffect(() => {
    if (!loaded || !data) {
      return;
    }

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
  }, [data, loaded]);

  /* =======================================================
     Fetch latest data
  ======================================================= */

  async function loadLatest(
    baseData = data
  ) {
    if (loading) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const knownNumbers =
        baseData?.tournaments
          ?.map((tournament) =>
            Number(tournament.number)
          )
          .filter(Number.isFinite) || [];

      const params =
        new URLSearchParams();

      if (knownNumbers.length > 0) {
        params.set(
          'known',
          knownNumbers.join(',')
        );
      }

      const url =
        params.toString().length > 0
          ? `/api/series?${params.toString()}`
          : '/api/series';

      const response = await fetch(url, {
        cache: 'no-store',
      });

      const json =
        await response.json();

      if (!response.ok) {
        throw new Error(
          json.error ||
            'データの取得に失敗しました'
        );
      }

      setData((current) =>
        mergeData(
          current || baseData,
          json
        )
      );
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

  /* =======================================================
     Initial latest check
  ======================================================= */

  useEffect(() => {
    if (!loaded) {
      return;
    }

    let cancelled = false;

    async function initialLoad() {
      try {
        const saved =
          localStorage.getItem(
            STORAGE_KEY
          );

        let savedData = null;

        if (saved) {
          const parsed =
            JSON.parse(saved);

          if (
            parsed?.players &&
            parsed?.stats
          ) {
            savedData = parsed;
          }
        }

        if (cancelled) {
          return;
        }

        await loadLatest(savedData);
      } catch (e) {
        console.error(
          '初回データ確認に失敗しました',
          e
        );
      }
    }

    initialLoad();

    return () => {
      cancelled = true;
    };
    // 初回だけ実行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /* =======================================================
     Reset
  ======================================================= */

  function resetData() {
    if (
      !window.confirm(
        '保存している人形劇のデータを削除して、最初から取得し直しますか？'
      )
    ) {
      return;
    }

    localStorage.removeItem(
      STORAGE_KEY
    );

    setData(null);
    setSelected('all');
    setSeason('all');
    setSortKey('rate');
    setError('');
  }

  /* =======================================================
     Players
  ======================================================= */

  const players = useMemo(() => {
    if (!data) {
      return [];
    }

    return [...(data.players || [])].sort(
      (a, b) =>
        String(a.name).localeCompare(
          String(b.name),
          'ja'
        )
    );
  }, [data]);

  /* =======================================================
     Seasons
  ======================================================= */

  const seasons = useMemo(() => {
    if (!data?.tournaments?.length) {
      return [];
    }

    const maxSeason = Math.max(
      ...data.tournaments.map(
        (tournament) =>
          getSeason(tournament.number)
      )
    );

    return Array.from(
      { length: maxSeason },
      (_, index) => index + 1
    );
  }, [data]);

  /* =======================================================
     Selected player
  ======================================================= */

  const selectedPlayer =
    useMemo(() => {
      if (
        !data ||
        selected === 'all'
      ) {
        return null;
      }

      return players.find(
        (player) =>
          String(player.id) ===
          String(selected)
      );
    }, [
      data,
      players,
      selected,
    ]);

  /* =======================================================
     Opponents
  ======================================================= */

  const opponents = useMemo(() => {
    if (
      !data ||
      !selectedPlayer
    ) {
      return [];
    }

    const ownStats =
      data.stats?.[
        selectedPlayer.id
      ] || {};

    return Object.entries(
      ownStats
    )
      .map(
        ([opponentId, stat]) => {
          const opponent =
            players.find(
              (player) =>
                String(player.id) ===
                String(opponentId)
            );

          if (!opponent) {
            return null;
          }

          const wins =
            Number(stat.wins || 0);

          const losses =
            Number(
              stat.losses || 0
            );

          const matches =
            wins + losses;

          return {
            ...opponent,

            wins,

            losses,

            matches,

            rate:
              stat.rate ??
              (matches
                ? Math.round(
                    (wins /
                      matches) *
                      1000
                  ) / 10
                : 0),
          };
        }
      )
      .filter(Boolean)
      .sort((a, b) => {
        if (sortKey === 'name') {
          return String(
            a.name
          ).localeCompare(
            String(b.name),
            'ja'
          );
        }

        if (
          sortKey === 'matches'
        ) {
          return (
            b.matches -
              a.matches ||
            b.rate - a.rate
          );
        }

        return (
          b.rate - a.rate ||
          b.matches -
            a.matches
        );
      });
  }, [
    data,
    players,
    selectedPlayer,
    sortKey,
  ]);

  /* =======================================================
     Match history
  ======================================================= */

  const matchHistory =
    useMemo(() => {
      if (
        !data ||
        !selectedPlayer
      ) {
        return [];
      }

      return (data.records || [])
        .filter((record) => {
          const winnerId =
            getWinnerId(record);

          const loserId =
            getLoserId(record);

          const playerId =
            String(
              selectedPlayer.id
            );

          return (
            String(winnerId) ===
              playerId ||
            String(loserId) ===
              playerId
          );
        })
        .filter((record) => {
          if (season === 'all') {
            return true;
          }

          return (
            getSeason(
              getTournamentNumber(
                record
              )
            ) ===
            Number(season)
          );
        })
        .sort(
          (a, b) =>
            getTournamentNumber(
              b
            ) -
            getTournamentNumber(
              a
            )
        );
    }, [
      data,
      selectedPlayer,
      season,
    ]);

  /* =======================================================
     Season ranking
  ======================================================= */

  const seasonRanking =
    useMemo(() => {
      if (!data) {
        return [];
      }

      const targetRecords =
        season === 'all'
          ? data.records || []
          : (
              data.records || []
            ).filter(
              (record) =>
                getSeason(
                  getTournamentNumber(
                    record
                  )
                ) ===
                Number(season)
            );

      const stats = {};

      for (const record of targetRecords) {
        const winnerId =
          getWinnerId(record);

        const loserId =
          getLoserId(record);

        if (
          winnerId == null ||
          loserId == null
        ) {
          continue;
        }

        const winner =
          String(winnerId);

        const loser =
          String(loserId);

        stats[winner] ??= {
          wins: 0,
          losses: 0,
        };

        stats[loser] ??= {
          wins: 0,
          losses: 0,
        };

        stats[winner].wins++;

        stats[loser].losses++;
      }

      return players
        .map((player) => {
          const stat =
            stats[
              String(player.id)
            ] || {
              wins: 0,
              losses: 0,
            };

          const total =
            stat.wins +
            stat.losses;

          return {
            ...player,

            wins: stat.wins,

            losses: stat.losses,

            total,

            rate: total
              ? Math.round(
                  (stat.wins /
                    total) *
                    1000
                ) / 10
              : 0,
          };
        })
        .filter(
          (player) =>
            player.total > 0
        )
        .sort(
          (a, b) =>
            b.rate - a.rate ||
            b.total -
              a.total ||
            b.wins -
              a.wins ||
            String(
              a.name
            ).localeCompare(
              String(b.name),
              'ja'
            )
        );
    }, [
      data,
      players,
      season,
    ]);

  /* =======================================================
     No data
  ======================================================= */

  if (!data) {
    return (
      <main className="container">
        <h1>人形劇 戦績</h1>

        <p>
          まだデータがありません。
        </p>

        <button
          className="button"
          onClick={() =>
            loadLatest(null)
          }
          disabled={loading}
        >
          {loading
            ? 'データ取得中…'
            : '人形劇のデータを取得'}
        </button>

        {error && (
          <p className="error">
            {error}
          </p>
        )}
      </main>
    );
  }

  /* =======================================================
     Main UI
  ======================================================= */

  return (
    <main className="container">
      <header className="header">
        <div>
          <h1>人形劇 戦績</h1>

          <p className="subTitle">
            Smashmate「人形劇」シリーズ
          </p>
        </div>

        <div className="headerActions">
          <button
            className="button"
            onClick={() =>
              loadLatest(data)
            }
            disabled={loading}
          >
            {loading
              ? '取得中…'
              : '最新データを取得'}
          </button>

          <button
            className="button secondary"
            onClick={resetData}
            disabled={loading}
          >
            データをリセット
          </button>
        </div>
      </header>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {/* ===================================================
          Summary
      =================================================== */}

      <section className="summary">
        <div>
          <strong>
            {data.tournaments?.length ||
              0}
          </strong>

          <span>大会</span>
        </div>

        <div>
          <strong>
            {data.records?.length ||
              data.matches ||
              0}
          </strong>

          <span>試合</span>
        </div>

        <div>
          <strong>
            {players.length}
          </strong>

          <span>選手</span>
        </div>

        <div>
          <strong>
            #{getLastTournament(
              data
            )}
          </strong>

          <span>最新大会</span>
        </div>
      </section>

      {/* ===================================================
          Overall ranking
      =================================================== */}

      <section className="section">
        <h2>総合ランキング</h2>

        <div className="seasonTabs">
          <button
            className={
              season === 'all'
                ? 'active'
                : ''
            }
            onClick={() =>
              setSeason('all')
            }
          >
            全期間
          </button>

          {seasons.map(
            (seasonNumber) => (
              <button
                key={seasonNumber}
                className={
                  Number(
                    season
                  ) ===
                  seasonNumber
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSeason(
                    seasonNumber
                  )
                }
              >
                Season{' '}
                {seasonNumber}

                <small>
                  #
                  {seasonNumber *
                    25 -
                    24}
                  〜#
                  {seasonNumber *
                    25}
                </small>
              </button>
            )
          )}
        </div>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>順位</th>
                <th>選手</th>
                <th>勝率</th>
                <th>勝</th>
                <th>敗</th>
                <th>試合数</th>
              </tr>
            </thead>

            <tbody>
              {seasonRanking.map(
                (
                  player,
                  index
                ) => (
                  <tr
                    key={
                      player.id
                    }
                  >
                    <td>
                      {index + 1}
                    </td>

                    <td>
                      <button
                        className="playerLink"
                        onClick={() => {
                          setSelected(
                            String(
                              player.id
                            )
                          );

                          window.scrollTo(
                            {
                              top: 0,
                              behavior:
                                'smooth',
                            }
                          );
                        }}
                      >
                        {
                          player.name
                        }
                      </button>
                    </td>

                    <td>
                      <strong>
                        {
                          player.rate
                        }
                        %
                      </strong>
                    </td>

                    <td>
                      {
                        player.wins
                      }
                    </td>

                    <td>
                      {
                        player.losses
                      }
                    </td>

                    <td>
                      {
                        player.total
                      }
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===================================================
          Player matchup
      =================================================== */}

      <section className="section">
        <h2>
          プレイヤー別対戦成績
        </h2>

        <div className="playerSelectWrap">
          <select
            value={selected}
            onChange={(event) =>
              setSelected(
                event.target.value
              )
            }
          >
            <option value="all">
              プレイヤーを選択
            </option>

            {players.map(
              (player) => (
                <option
                  key={player.id}
                  value={
                    player.id
                  }
                >
                  {player.name}
                </option>
              )
            )}
          </select>
        </div>

        {selectedPlayer ? (
          <>
            <h3 className="selectedPlayer">
              {
                selectedPlayer.name
              }
            </h3>

            <div className="sortButtons">
              <button
                className={
                  sortKey === 'rate'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSortKey('rate')
                }
              >
                勝率順
              </button>

              <button
                className={
                  sortKey ===
                  'matches'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSortKey(
                    'matches'
                  )
                }
              >
                対戦数順
              </button>

              <button
                className={
                  sortKey === 'name'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSortKey('name')
                }
              >
                名前順
              </button>
            </div>

            <div className="tableWrap">
              <table className="opponentTable">
                <thead>
                  <tr>
                    <th>
                      対戦相手
                    </th>

                    <th>
                      勝率
                    </th>

                    <th>
                      戦績
                    </th>

                    <th>
                      試合数
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {opponents.map(
                    (opponent) => {
                      const recentResults =
                        getRecentResults(
                          data.records,
                          selectedPlayer.id,
                          opponent.id
                        );

                      return (
                        <tr
                          key={
                            opponent.id
                          }
                        >
                          <td className="opponentCell">
                            <div className="opponentName">
                              {
                                opponent.name
                              }
                            </div>
                          </td>

                          <td className="rateCell">
                            <strong>
                              {
                                opponent.rate
                              }
                              %
                            </strong>
                          </td>

                          <td className="recordCell">
                            <div className="recordSummary">
                              <span className="recordWin">
                                {
                                  opponent.wins
                                }
                                勝
                              </span>

                              <span className="recordLoss">
                                {
                                  opponent.losses
                                }
                                敗
                              </span>
                            </div>

                            <div className="recentResults">
                              {recentResults.length >
                              0 ? (
                                recentResults.map(
                                  (
                                    result,
                                    index
                                  ) => (
                                    <div
                                      key={`${opponent.id}-${result.tournamentNumber}-${index}`}
                                      className={`recentResult ${
                                        result.result ===
                                        'W'
                                          ? 'win'
                                          : 'loss'
                                      } ${
                                        index ===
                                        0
                                          ? 'latest'
                                          : ''
                                      }`}
                                      title={
                                        index ===
                                        0
                                          ? '最新'
                                          : undefined
                                      }
                                    >
                                      {
                                        result.result
                                      }
                                    </div>
                                  )
                                )
                              ) : (
                                <div className="recentNoData">
                                  直近の試合データなし
                                </div>
                              )}
                            </div>
                          </td>

                          <td className="matchesCell">
                            <div className="matchesValue">
                              {
                                opponent.matches
                              }
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>

            {/* =================================================
                Match history
            ================================================= */}

            <h3>
              対戦履歴
            </h3>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      大会
                    </th>

                    <th>
                      対戦相手
                    </th>

                    <th>
                      結果
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {matchHistory.map(
                    (
                      record,
                      index
                    ) => {
                      const winnerId =
                        getWinnerId(
                          record
                        );

                      const loserId =
                        getLoserId(
                          record
                        );

                      const selectedId =
                        String(
                          selectedPlayer.id
                        );

                      const isWinner =
                        String(
                          winnerId
                        ) ===
                        selectedId;

                      const opponentId =
                        isWinner
                          ? loserId
                          : winnerId;

                      const opponent =
                        players.find(
                          (player) =>
                            String(
                              player.id
                            ) ===
                            String(
                              opponentId
                            )
                        );

                      return (
                        <tr
                          key={`${getTournamentNumber(
                            record
                          )}-${winnerId}-${loserId}-${index}`}
                        >
                          <td>
                            人形劇#
                            {
                              getTournamentNumber(
                                record
                              )
                            }
                          </td>

                          <td>
                            {opponent
                              ?.name ||
                              (isWinner
                                ? record.loser
                                : record.winner) ||
                              '不明'}
                          </td>

                          <td>
                            <strong
                              className={
                                isWinner
                                  ? 'resultWin'
                                  : 'resultLoss'
                              }
                            >
                              {isWinner
                                ? '勝ち'
                                : '負け'}
                            </strong>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p>
            プレイヤーを選択すると、
            対戦相手ごとの成績を表示します。
          </p>
        )}
      </section>

      {/* ===================================================
          Tournament list
      =================================================== */}

      <section className="section">
        <h2>大会一覧</h2>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>
                  大会
                </th>

                <th>
                  試合数
                </th>

                <th>
                  参加人数
                </th>
              </tr>
            </thead>

            <tbody>
              {[
                ...(data.tournaments ||
                  []),
              ]
                .sort(
                  (a, b) =>
                    Number(
                      b.number
                    ) -
                    Number(
                      a.number
                    )
                )
                .map(
                  (tournament) => (
                    <tr
                      key={
                        tournament.number
                      }
                    >
                      <td>
                        <a
                          href={
                            tournament.tournamentUrl
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          人形劇#
                          {
                            tournament.number
                          }
                        </a>
                      </td>

                      <td>
                        {
                          tournament.matches
                        }
                      </td>

                      <td>
                        {
                          tournament.players
                        }
                      </td>
                    </tr>
                  )
                )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===================================================
          Failed tournaments
      =================================================== */}

      {data.failed?.length >
        0 && (
        <section className="section">
          <h2>
            取得できなかった大会
          </h2>

          <ul>
            {data.failed.map(
              (item) => (
                <li
                  key={item.number}
                >
                  人形劇#
                  {item.number}：
                  {item.error}
                </li>
              )
            )}
          </ul>
        </section>
      )}

      {/* ===================================================
          Footer
      =================================================== */}

      <footer className="footer">
        <p>
          データ元：Smashmate
        </p>

        <p>
          最終取得：
          {new Date().toLocaleString(
            'ja-JP'
          )}
        </p>
      </footer>
    </main>
  );
}
