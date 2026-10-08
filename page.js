'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useState,
} from 'react';

const STORAGE_KEY = 'ningyogeki-stats-v3';

function getValueId(value) {
  if (value == null) return null;

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
  return getValueId(
    record?.winnerId ??
      record?.winner_id ??
      record?.winner ??
      record?.winnerPlayer ??
      record?.winner_player
  );
}

function getLoserId(record) {
  return getValueId(
    record?.loserId ??
      record?.loser_id ??
      record?.loser ??
      record?.loserPlayer ??
      record?.loser_player
  );
}

function getTournamentNumber(record) {
  return Number(
    record?.tournamentNumber ??
      record?.tournament_number ??
      record?.tournament ??
      0
  );
}

function getPlayerName(record, side) {
  if (!record) return '';

  if (side === 'winner') {
    if (typeof record.winner === 'string') {
      return record.winner;
    }

    if (
      record.winner &&
      typeof record.winner === 'object'
    ) {
      return (
        record.winner.name ??
        record.winner.playerName ??
        ''
      );
    }

    return (
      record.winnerName ??
      record.winner_name ??
      ''
    );
  }

  if (typeof record.loser === 'string') {
    return record.loser;
  }

  if (
    record.loser &&
    typeof record.loser === 'object'
  ) {
    return (
      record.loser.name ??
      record.loser.playerName ??
      ''
    );
  }

  return (
    record.loserName ??
    record.loser_name ??
    ''
  );
}

function mergeStats(base = {}, added = {}) {
  const result = structuredClone(base);

  for (const [playerId, opponents] of Object.entries(
    added || {}
  )) {
    result[playerId] ??= {};

    for (const [opponentId, stat] of Object.entries(
      opponents || {}
    )) {
      result[playerId][opponentId] ??= {
        wins: 0,
        losses: 0,
      };

      result[playerId][opponentId].wins +=
        stat.wins || 0;

      result[playerId][opponentId].losses +=
        stat.losses || 0;

      const total =
        result[playerId][opponentId].wins +
        result[playerId][opponentId].losses;

      result[playerId][opponentId].rate = total
        ? Math.round(
            (result[playerId][opponentId].wins /
              total) *
              1000
          ) / 10
        : 0;
    }
  }

  return result;
}

function mergeData(oldData, newData) {
  if (!oldData) {
    return newData;
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
    tournamentMap.set(tournament.number, tournament);
  }

  for (const tournament of newData.tournaments || []) {
    tournamentMap.set(tournament.number, tournament);
  }

  const recordMap = new Map();

  for (const record of [
    ...(oldData.records || []),
    ...(newData.records || []),
  ]) {
    const key = [
      getTournamentNumber(record),
      getWinnerId(record),
      getLoserId(record),
    ].join('-');

    recordMap.set(key, record);
  }

  return {
    ...oldData,
    ...newData,

    players: [...playerMap.values()],

    tournaments: [...tournamentMap.values()].sort(
      (a, b) => a.number - b.number
    ),

    records: [...recordMap.values()],

    stats: mergeStats(
      oldData.stats,
      newData.stats
    ),

    matches:
      (oldData.matches || 0) +
      (newData.matches || 0),

    failed: newData.failed || [],
  };
}

function getLastTournament(data) {
  if (!data?.tournaments?.length) {
    return 0;
  }

  return Math.max(
    ...data.tournaments.map(
      (t) => t.number || 0
    )
  );
}

function getSeason(number) {
  if (!number) return 1;

  return Math.floor(
    (number - 1) / 25
  ) + 1;
}

/*
 * 選択プレイヤーと対戦相手の直近5戦
 */
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
    .filter((record) => {
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
    .sort(
      (a, b) =>
        getTournamentNumber(b) -
        getTournamentNumber(a)
    )
    .slice(0, 5)
    .map((record) => ({
      result:
        String(getWinnerId(record)) === player
          ? 'W'
          : 'L',
      tournamentNumber:
        getTournamentNumber(record),
    }));
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] =
    useState('all');

  const [sortKey, setSortKey] =
    useState('rate');

  const [season, setSeason] =
    useState('all');

  const [loaded, setLoaded] =
    useState(false);

  const [expandedOpponent, setExpandedOpponent] =
    useState(null);

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

  useEffect(() => {
    if (!loaded || !data) return;

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

  async function loadLatest() {
    setLoading(true);
    setError('');

    try {
      const lastTournament =
        getLastTournament(data);

      const url =
        lastTournament > 0
          ? `/api/series?since=${lastTournament}`
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
        mergeData(current, json)
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

  function resetData() {
    if (
      !window.confirm(
        '保存している人形劇のデータを削除して、最初から取得し直しますか？'
      )
    ) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);

    setData(null);
    setSelected('all');
    setSeason('all');
    setSortKey('rate');
    setExpandedOpponent(null);
    setError('');
  }

  const players = useMemo(() => {
    if (!data) return [];

    return [...(data.players || [])].sort(
      (a, b) =>
        String(a.name).localeCompare(
          String(b.name),
          'ja'
        )
    );
  }, [data]);

  const seasons = useMemo(() => {
    if (!data?.tournaments?.length) {
      return [];
    }

    const maxSeason = Math.max(
      ...data.tournaments.map((t) =>
        getSeason(t.number)
      )
    );

    return Array.from(
      { length: maxSeason },
      (_, index) => index + 1
    );
  }, [data]);

  const selectedPlayer = useMemo(() => {
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

  const opponents = useMemo(() => {
    if (!data || !selectedPlayer) {
      return [];
    }

    const ownStats =
      data.stats?.[selectedPlayer.id] ||
      {};

    return Object.entries(ownStats)
      .map(([opponentId, stat]) => {
        const opponent =
          players.find(
            (player) =>
              String(player.id) ===
              String(opponentId)
          );

        if (!opponent) {
          return null;
        }

        const matches =
          (stat.wins || 0) +
          (stat.losses || 0);

        return {
          ...opponent,
          wins: stat.wins || 0,
          losses: stat.losses || 0,
          matches,
          rate: stat.rate || 0,
        };
      })
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

        if (sortKey === 'matches') {
          return (
            b.matches - a.matches ||
            b.rate - a.rate
          );
        }

        return (
          b.rate - a.rate ||
          b.matches - a.matches
        );
      });
  }, [
    data,
    players,
    selectedPlayer,
    sortKey,
  ]);

  const matchHistory = useMemo(() => {
    if (!data || !selectedPlayer) {
      return [];
    }

    return (data.records || [])
      .filter((record) => {
        const winnerId =
          getWinnerId(record);

        const loserId =
          getLoserId(record);

        return (
          String(winnerId) ===
            String(selectedPlayer.id) ||
          String(loserId) ===
            String(selectedPlayer.id)
        );
      })
      .filter((record) => {
        if (season === 'all') {
          return true;
        }

        return (
          getSeason(
            getTournamentNumber(record)
          ) === Number(season)
        );
      })
      .sort(
        (a, b) =>
          getTournamentNumber(b) -
          getTournamentNumber(a)
      );
  }, [
    data,
    selectedPlayer,
    season,
  ]);

  const seasonRanking = useMemo(() => {
    if (!data) return [];

    const targetRecords =
      season === 'all'
        ? data.records || []
        : (data.records || []).filter(
            (record) =>
              getSeason(
                getTournamentNumber(record)
              ) === Number(season)
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

      stats[winnerId] ??= {
        wins: 0,
        losses: 0,
      };

      stats[loserId] ??= {
        wins: 0,
        losses: 0,
      };

      stats[winnerId].wins++;
      stats[loserId].losses++;
    }

    return players
      .map((player) => {
        const stat =
          stats[player.id] || {
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
                (stat.wins / total) *
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
          b.total - a.total ||
          b.wins - a.wins ||
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

  if (!data) {
    return (
      <main className="container">
        <h1>人形劇 戦績</h1>

        <p>
          まだデータがありません。
        </p>

        <button
          className="button"
          onClick={loadLatest}
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
            onClick={loadLatest}
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

      <section className="summary">
        <div>
          <strong>
            {data.tournaments?.length || 0}
          </strong>
          <span>大会</span>
        </div>

        <div>
          <strong>
            {data.matches || 0}
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
            #{getLastTournament(data)}
          </strong>
          <span>最新大会</span>
        </div>
      </section>

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
                  Number(season) ===
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
                Season {seasonNumber}

                <small>
                  #
                  {seasonNumber * 25 - 24}
                  〜#
                  {seasonNumber * 25}
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
                (player, index) => (
                  <tr key={player.id}>
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

                          setExpandedOpponent(
                            null
                          );

                          window.scrollTo({
                            top: 0,
                            behavior:
                              'smooth',
                          });
                        }}
                      >
                        {player.name}
                      </button>
                    </td>

                    <td>
                      <strong>
                        {player.rate}%
                      </strong>
                    </td>

                    <td>
                      {player.wins}
                    </td>

                    <td>
                      {player.losses}
                    </td>

                    <td>
                      {player.total}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>
          プレイヤー別対戦成績
        </h2>

        <div className="playerSelectWrap">
          <select
            value={selected}
            onChange={(e) => {
              setSelected(
                e.target.value
              );

              setExpandedOpponent(
                null
              );
            }}
          >
            <option value="all">
              プレイヤーを選択
            </option>

            {players.map((player) => (
              <option
                key={player.id}
                value={player.id}
              >
                {player.name}
              </option>
            ))}
          </select>
        </div>

        {selectedPlayer ? (
          <>
            <h3 className="selectedPlayer">
              {selectedPlayer.name}
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
                  sortKey === 'matches'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setSortKey('matches')
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

            <div className="tableWrap opponentTableWrap">
              <table className="opponentTable">
                <thead>
                  <tr>
                    <th>対戦相手</th>
                    <th>勝率</th>
                    <th>戦績</th>
                    <th>試合数</th>
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

                      const isExpanded =
                        expandedOpponent ===
                        String(
                          opponent.id
                        );

                      return (
                        <Fragment
                          key={opponent.id}
                        >
                          <tr
                            className={`opponentRow ${
                              isExpanded
                                ? 'expanded'
                                : ''
                            }`}
                            onClick={() => {
                              setExpandedOpponent(
                                isExpanded
                                  ? null
                                  : String(
                                      opponent.id
                                    )
                              );
                            }}
                          >
                            <td className="opponentCell">
                              <div className="opponentName">
                                {opponent.name}
                              </div>

                              <div className="opponentTapHint">
                                {isExpanded
                                  ? 'タップで閉じる'
                                  : 'タップで直近5戦'}
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
                                <span>
                                  {
                                    opponent.wins
                                  }
                                  勝
                                </span>

                                <span>
                                  {
                                    opponent.losses
                                  }
                                  敗
                                </span>
                              </div>
                            </td>

                            <td className="matchesCell">
                              <div className="matchesValue">
                                {
                                  opponent.matches
                                }
                              </div>

                              <div className="opponentArrow">
                                {isExpanded
                                  ? '▲'
                                  : '▼'}
                              </div>
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr className="recentDetailRow">
                              <td
                                colSpan="4"
                                className="recentDetailCell"
                              >
                                <div className="recentDetail">

                                  <div className="recentDetailTitle">
                                    <span>
                                      直近5戦
                                    </span>

                                    <small>
                                      左が最新
                                    </small>
                                  </div>

                                  {recentResults.length > 0 ? (
                                    <div className="recentResults">
                                      {recentResults.map(
                                        (
                                          result,
                                          index
                                        ) => (
                                          <div
                                            key={`${result.tournamentNumber}-${index}`}
                                            className="recentItem"
                                          >
                                            <div
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
                                            >
                                              {
                                                result.result
                                              }
                                            </div>

                                            <span className="recentTournament">
                                              #
                                              {
                                                result.tournamentNumber
                                              }
                                            </span>
                                          </div>
                                        )
                                      )}
                                    </div>
                                  ) : (
                                    <div className="recentNoData">
                                      この対戦の試合データがありません
                                    </div>
                                  )}

                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>

            <h3>
              対戦履歴
            </h3>

            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>大会</th>
                    <th>対戦相手</th>
                    <th>結果</th>
                  </tr>
                </thead>

                <tbody>
                  {matchHistory.map(
                    (record, index) => {
                      const isWinner =
                        String(
                          getWinnerId(record)
                        ) ===
                        String(
                          selectedPlayer.id
                        );

                      const opponentName =
                        isWinner
                          ? getPlayerName(
                              record,
                              'loser'
                            )
                          : getPlayerName(
                              record,
                              'winner'
                            );

                      return (
                        <tr
                          key={`${getTournamentNumber(
                            record
                          )}-${index}`}
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
                            {opponentName || '—'}
                          </td>

                          <td>
                            <strong>
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

      <section className="section">
        <h2>大会一覧</h2>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>大会</th>
                <th>試合数</th>
                <th>参加人数</th>
              </tr>
            </thead>

            <tbody>
              {[...(data.tournaments || [])]
                .sort(
                  (a, b) =>
                    b.number - a.number
                )
                .map((tournament) => (
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
                      {tournament.matches}
                    </td>

                    <td>
                      {tournament.players}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {data.failed?.length > 0 && (
        <section className="section">
          <h2>
            取得できなかった大会
          </h2>

          <ul>
            {data.failed.map(
              (item) => (
                <li key={item.number}>
                  人形劇#
                  {item.number}：
                  {item.error}
                </li>
              )
            )}
          </ul>
        </section>
      )}

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
