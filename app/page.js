\
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
        ? Math.round((result[playerId][opponentId].wins / total) * 1000) / 10
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

function getSeason(number) {
  if (!number) return 1;
  return Math.floor((number - 1) / 25) + 1;
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState('all');
  const [show, setShow] = useState(false);
  const [sortKey, setSortKey] = useState('matches');
  const [sortDir, setSortDir] = useState('desc');
  const [season, setSeason] = useState('all');

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

      const response = await fetch(url, { cache: 'no-store' });
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error || '取得に失敗しました');
      }

      if (savedData && (!json.tournaments || json.tournaments.length === 0)) {
        return;
      }

      setData((current) => mergeData(current || savedData, json));
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'データの取得に失敗しました');
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
        if (parsed?.players && parsed?.stats && parsed?.tournaments) {
          savedData = parsed;
          setData(parsed);
        }
      }
    } catch (e) {
      console.error('保存データの読み込みに失敗しました', e);
    }

    // 保存済みデータを即表示したうえで、裏で「未取得大会があるか」だけ確認する。
    // API側は既存大会を再取得せず、未取得大会だけを処理する。
    loadLatest(savedData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('データ保存に失敗しました', e);
    }
  }, [data]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'opponent' ? 'asc' : 'desc');
    }
  }

  function sortMark(key) {
    return sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  }

  function resetData() {
    if (!window.confirm('保存データを削除して、全大会を最初から取得し直しますか？')) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    setData(null);
    setSelected('all');
    setSeason('all');
    setError('');
  }

  const sortedPlayers = useMemo(
    () =>
      data
        ? [...data.players].sort((a, b) =>
            String(a.name).localeCompare(String(b.name), 'ja')
          )
        : [],
    [data]
  );

  const seasons = useMemo(() => {
    if (!data?.tournaments?.length) return [];
    const max = Math.max(...data.tournaments.map((t) => Number(t.number) || 0));
    return Array.from({ length: Math.ceil(max / 25) }, (_, i) => ({
      key: String(i + 1),
      label: `シーズン${i + 1}`,
      from: i * 25 + 1,
      to: (i + 1) * 25,
    }));
  }, [data]);

  const ranking = useMemo(() => {
    if (!data) return [];

    const records =
      season === 'all'
        ? data.records
        : data.records.filter((r) => {
            const n = Number(r.tournamentNumber) || 0;
            const s = Number(season);
            return n >= (s - 1) * 25 + 1 && n <= s * 25;
          });

    const totals = new Map();
    for (const record of records) {
      const winner = totals.get(record.winnerId) || { wins: 0, losses: 0 };
      winner.wins++;
      totals.set(record.winnerId, winner);

      const loser = totals.get(record.loserId) || { wins: 0, losses: 0 };
      loser.losses++;
      totals.set(record.loserId, loser);
    }

    return data.players
      .map((player) => {
        const x = totals.get(player.id) || { wins: 0, losses: 0 };
        const total = x.wins + x.losses;
        return {
          ...player,
          wins: x.wins,
          losses: x.losses,
          total,
          rate: total ? Math.round((x.wins / total) * 1000) / 10 : 0,
        };
      })
      .filter((player) => player.total > 0)
      .sort(
        (a, b) =>
          b.rate - a.rate ||
          b.total - a.total ||
          b.wins - a.wins ||
          String(a.name).localeCompare(String(b.name), 'ja')
      );
  }, [data, season]);

  const selectedPlayer = data?.players.find(
    (player) => String(player.id) === String(selected)
  );

  const opponentRows = useMemo(() => {
    if (!data || !selectedPlayer) return [];

    return data.players
      .filter(
        (player) =>
          String(player.id) !== String(selectedPlayer.id) &&
          data.stats?.[selectedPlayer.id]?.[player.id]
      )
      .map((player) => ({
        player,
        stat: data.stats[selectedPlayer.id][player.id],
      }))
      .sort((a, b) => {
        if (sortKey === 'opponent') {
          const result = a.player.name.localeCompare(b.player.name, 'ja');
          return sortDir === 'asc' ? result : -result;
        }

        const av = sortKey === 'rate'
          ? a.stat.rate || 0
          : (a.stat.wins || 0) + (a.stat.losses || 0);
        const bv = sortKey === 'rate'
          ? b.stat.rate || 0
          : (b.stat.wins || 0) + (b.stat.losses || 0);

        return sortDir === 'asc'
          ? av - bv || b.stat.wins - a.stat.wins
          : bv - av || b.stat.wins - a.stat.wins;
      });
  }, [data, selectedPlayer, sortKey, sortDir]);

  if (!data) {
    return (
      <main className="site">
        <div className="content">
          <section className="empty card">
            <div className="spinner" />
            <h2>{loading ? '人形劇のデータを確認しています' : '人形劇のデータを取得します'}</h2>
            <p>{loading ? '保存済みデータがあれば、それを表示したうえで未取得の大会だけ確認しています。' : '大会一覧とトーナメント表を取得します。'}</p>
            {!loading && (
              <button className="primary" onClick={() => loadLatest(null, true)}>
                データを取得
              </button>
            )}
            {error && <p className="error">⚠ {error}</p>}
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
            <div className="eyebrow">SMASHMATE / TOURNAMENT STATS</div>
            <h1>人形劇 <span>戦績表</span></h1>
            <p>人形劇シリーズ全体の直接対戦成績をまとめて確認できます。</p>
          </div>
        </div>
      </header>

      <div className="content">
        <section className="control card">
          <div>
            <div className="sectionLabel">NINGYOGEKI SERIES</div>
            <h2>シリーズ全体を集計</h2>
            <p>ページを開くたびに大会一覧だけを確認し、まだ読み込んでいない大会がある場合だけ取得します。</p>
          </div>
          <div className="buttonGroup">
            <button className="primary" onClick={() => loadLatest()} disabled={loading}>
              {loading ? '未取得大会を確認中…' : '最新データを確認'}
            </button>
            <button className="secondary" onClick={resetData} disabled={loading}>
              保存データをリセット
            </button>
          </div>
          <div className="hint">
            {loading ? '既存の大会は再取得しません。' : '未取得の大会がある場合だけ追加で読み込みます。'}
          </div>
        </section>

        {error && <div className="error card">⚠ {error}</div>}

        <section className="statsGrid">
          <div className="stat card"><span>取得大会</span><strong>{data.tournaments.length}</strong><small>tournaments</small></div>
          <div className="stat card"><span>参加人数</span><strong>{data.players.length}</strong><small>players</small></div>
          <div className="stat card"><span>総対戦数</span><strong>{data.matches}</strong><small>matches</small></div>
        </section>

        <section className="card matrixCard">
          <div className="sectionHead">
            <div>
              <div className="sectionLabel">PLAYER VIEW</div>
              <h2>対戦表</h2>
              <p>最初は全員分。名前を選ぶと、その選手視点の戦績に切り替わります。</p>
            </div>
          </div>

          <div className="playerSelectWrap">
            <label htmlFor="playerSelect">表示する選手</label>
            <select id="playerSelect" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="all">全体（全選手）</option>
              {sortedPlayers.map((player) => (
                <option key={player.id} value={player.id}>{player.name}</option>
              ))}
            </select>
          </div>

          {selected === 'all' ? (
            <div className="matrixWrap">
              <table className="matrix">
                <thead><tr><th>PLAYER</th>{data.players.map((player) => <th key={player.id}>{player.name}</th>)}</tr></thead>
                <tbody>
                  {data.players.map((row) => (
                    <tr key={row.id}>
                      <th>{row.name}</th>
                      {data.players.map((col) => {
                        const stat = data.stats?.[row.id]?.[col.id];
                        return (
                          <td key={col.id} className={row.id === col.id ? 'self' : stat ? 'hasData' : ''}>
                            {row.id === col.id ? '—' : stat ? <><strong>{rate(stat)}</strong><small>{stat.wins}-{stat.losses}</small></> : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="playerTableWrap">
              <table className="playerTable">
                <colgroup><col className="opponentCol" /><col className="rateCol" /><col className="recordCol" /><col className="matchesCol" /></colgroup>
                <thead>
                  <tr>
                    <th><button className="sortButton" onClick={() => toggleSort('opponent')}>対戦相手{sortMark('opponent')}</button></th>
                    <th><button className="sortButton" onClick={() => toggleSort('rate')}>勝率{sortMark('rate')}</button></th>
                    <th>戦績</th>
                    <th><button className="sortButton" onClick={() => toggleSort('matches')}>対戦数{sortMark('matches')}</button></th>
                  </tr>
                </thead>
                <tbody>
                  {opponentRows.map(({ player, stat }) => (
                    <tr key={player.id}>
                      <td className="opponentName">{player.name}</td>
                      <td><strong>{stat.rate}%</strong></td>
                      <td>{stat.wins}勝 {stat.losses}敗</td>
                      <td>{stat.wins + stat.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="sectionHead">
            <div><div className="sectionLabel">SERIES WIN RATE</div><h2>シリーズ勝率ランキング</h2><p>25大会ごとにシーズンを区切って表示できます。</p></div>
            <span className="badge">WIN RATE</span>
          </div>
          <div className="seasonTabs">
            <button className={season === 'all' ? 'active' : ''} onClick={() => setSeason('all')}>すべて</button>
            {seasons.map((s) => <button key={s.key} className={season === s.key ? 'active' : ''} onClick={() => setSeason(s.key)}>{s.label}</button>)}
          </div>
          <div className="rankingList">
            {ranking.map((player, index) => (
              <div className="rankRow" key={player.id}>
                <div className="rankNo">{String(index + 1).padStart(2, '0')}</div>
                <div className="rankName">{player.name}</div>
                <div className="bar"><i style={{ width: `${player.rate}%` }} /></div>
                <div className="rankRate">{player.rate}%</div>
                <div className="record">{player.wins}勝 {player.losses}敗 / {player.total}戦</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="sectionHead">
            <div><div className="sectionLabel">TOURNAMENTS</div><h2>取得した人形劇大会</h2></div>
            <span className="badge">{data.tournaments.length}</span>
          </div>
          <div className="tournamentList">
            {data.tournaments.slice().reverse().map((tournament) => (
              <a key={tournament.number} href={tournament.bracketUrl} target="_blank" rel="noreferrer">
                <b>人形劇#{tournament.number}</b><span>{tournament.players}人 / {tournament.matches}試合</span><em>↗</em>
              </a>
            ))}
          </div>
        </section>

        <section className="card matchesCard">
          <button className="collapse" onClick={() => setShow(!show)}>{show ? '▼' : '▶'} 全対戦履歴 <span>{data.records.length} MATCHES</span></button>
          {show && <div className="matchList">{data.records.map((match, index) => <div className="match" key={`${match.tournamentNumber}-${match.winnerId}-${match.loserId}-${index}`}><span className="round">#{match.tournamentNumber}</span><span className="winner">{match.winner}</span><b>WIN</b><span className="loser">{match.loser}</span></div>)}</div>}
        </section>

        <footer>NINGYOGEKI STATS <span>—</span> Smashmate tournament results</footer>
      </div>
    </main>
  );
}
