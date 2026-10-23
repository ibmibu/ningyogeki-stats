'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CHARACTER_ALIASES } from './data/characterAliases';
import { MANUAL_CHARACTER_REPORTS } from './data/manualCharacterReports';
import { calculateElo, calculateTournamentTierScores } from '../lib/ratings';
import { getPlayerAchievements } from '../lib/stats-data';

const STORAGE_KEY = 'ningyogeki-stats-v4';

const ACCOUNT_ALIASES = {
  '99450': '145071',
  '118591': '149650',
  '148400': '164481',
  '80108': '142959',
  '100389': '167992',
  '159344': '167992',
  '156108': '156414',
};

function canonicalAccountId(id) {
  let value = String(id);
  const visited = new Set();
  while (ACCOUNT_ALIASES[value] && !visited.has(value)) {
    visited.add(value);
    value = ACCOUNT_ALIASES[value];
  }
  return value;
}

function normalizeTournamentName(value) {
  return String(value || '').normalize('NFKC').replace(/[\s#＃]/gu, '');
}

function normalizePlayerName(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, '').trim();
}

function rate(stat) {
  return stat ? `${stat.rate}%` : '—';
}

// ファイター名は、一覧にある正式表記との一致だけを集計する。表記ゆれ対応は後で追加する。
const knownCharacters = [
  'マリオ', 'ドンキーコング', 'リンク', 'サムス', 'ダークサムス', 'ヨッシー',
  'カービィ', 'フォックス', 'ピカチュウ', 'ルイージ', 'ネス', 'キャプテン・ファルコン',
  'プリン', 'ピーチ', 'デイジー', 'クッパ', 'アイスクライマー', 'シーク', 'ゼルダ',
  'ドクターマリオ', 'ピチュー', 'ファルコ', 'マルス', 'ルキナ', 'こどもリンク',
  'ガノンドロフ', 'ミュウツー', 'ロイ', 'クロム', 'Mr.ゲーム＆ウォッチ', 'メタナイト',
  'ピット', 'ブラックピット', 'ゼロスーツサムス', 'ワリオ', 'スネーク', 'アイク',
  'ポケモントレーナー', 'ディディーコング', 'リュカ', 'ソニック', 'デデデ',
  'ピクミン＆オリマー', 'ルカリオ', 'ロボット', 'トゥーンリンク', 'ウルフ', 'むらびと',
  'ロックマン', 'Wii Fit トレーナー', 'ロゼッタ＆チコ', 'リトル・マック', 'ゲッコウガ',
  'Mii 格闘タイプ', 'Mii 剣術タイプ', 'Mii 射撃タイプ', 'パルテナ', 'パックマン',
  'ルフレ', 'シュルク', 'クッパJr.', 'ダックハント', 'リュウ', 'ケン', 'クラウド',
  'カムイ', 'ベヨネッタ', 'インクリング', 'リドリー', 'シモン', 'リヒター',
  'キングクルール', 'しずえ', 'ガオガエン', 'パックンフラワー', 'ジョーカー', '勇者',
  'バンジョー＆カズーイ', 'テリー', 'ベレト／ベレス', 'ミェンミェン', 'スティーブ',
  'セフィロス', 'ホムラ／ヒカリ', 'カズヤ', 'ソラ'
];
const normalizedKnownCharacters = new Set(knownCharacters.map((name) => name.normalize('NFKC')));
const aliasEntries = Object.entries(CHARACTER_ALIASES)
  .map(([alias, officialName]) => [String(alias).normalize('NFKC'), String(officialName)])
  .filter(([alias, officialName]) => alias && normalizedKnownCharacters.has(officialName.normalize('NFKC')));
const characterPatterns = [
  ...knownCharacters.map((name) => ({ match: name.normalize('NFKC'), officialName: name })),
  ...aliasEntries.map(([match, officialName]) => ({ match, officialName })),
].sort((a, b) => b.match.length - a.match.length);
// キャラ名の直後が文字列の続きなら誤認識を避ける。
// 単独名・空白・数字・記号の後に続く表記を認識し、「ソラニン」などは除外する。
const isJapaneseWordChar = (char) => Boolean(char && /[ぁ-んァ-ヶ一-龯々ー]/u.test(char));
const isNameContinuation = (char) => Boolean(char && /[A-Za-zぁ-んァ-ヶ一-龯々ー]/u.test(char));
const findExactName = (text, name) => {
  let fromIndex = 0;
  while (fromIndex <= text.length - name.length) {
    const index = text.indexOf(name, fromIndex);
    if (index === -1) return -1;
    const nextChar = text[index + name.length];
    if (!isJapaneseWordChar(nextChar) && !(nextChar && /[A-Za-z]/u.test(nextChar))) return index;
    // 数字・空白・記号は区切りとして認める。日本語や英字が続く場合だけ除外。
    fromIndex = index + name.length;
  }
  return -1;
};
const removeExactName = (text, name) => {
  let result = '';
  let fromIndex = 0;
  while (fromIndex < text.length) {
    const index = text.indexOf(name, fromIndex);
    if (index === -1) return result + text.slice(fromIndex);
    const nextChar = text[index + name.length];
    if (isNameContinuation(nextChar)) {
      result += text.slice(fromIndex, index + name.length);
      fromIndex = index + name.length;
    } else {
      result += text.slice(fromIndex, index) + ' ';
      fromIndex = index + name.length;
    }
  }
  return result;
};


export default function Home() {
  const [data, setData] = useState(null);
  const archiveInputRef = useRef(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [overlaySyncStatus, setOverlaySyncStatus] = useState('ローカル連携は未確認です。');
  const [selected, setSelected] = useState(() => {
    if (typeof window === 'undefined') return 'all';
    return localStorage.getItem('ningyogeki-selected-player') || 'all';
  });
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerSearchOpen, setPlayerSearchOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [showAllTitles, setShowAllTitles] = useState(false);
  const [sortKey, setSortKey] = useState('opponent');
  const [sortDir, setSortDir] = useState('asc');
  const [season, setSeason] = useState('current');
  const [matrixSeason, setMatrixSeason] = useState('current');
  const [rateChartPlayers, setRateChartPlayers] = useState([]);
  const [characterComments, setCharacterComments] = useState(null);
  const [characterCacheLoaded, setCharacterCacheLoaded] = useState(false);
  const [characterProgress, setCharacterProgress] = useState({ done: 0, total: 0 });
  const [characterError, setCharacterError] = useState('');
  const [expandedSoloCharacters, setExpandedSoloCharacters] = useState([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ningyogeki-character-comments-v7');
      if (saved) setCharacterComments(JSON.parse(saved));
    } catch {}
    setCharacterCacheLoaded(true);
  }, []);

  // キャラクターコメントはバックアップに保存されたキャッシュのみを使用する。
  // Smashmateへの自動アクセスは行わない。



  useEffect(() => {
    let savedData = null;

    try {
      // v4がなければ、以前のバージョンで保存したv3の戦績も引き継ぐ。
      // 保存キーを変更しただけで既存大会が未取得扱いになるのを防ぐ。
      const saved =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem('ningyogeki-stats-v3');

      if (saved) {
        const parsed = JSON.parse(saved);

        if (
          parsed?.players &&
          parsed?.stats &&
          parsed?.tournaments
        ) {
          savedData = parsed;
          setData(parsed);
          // 新しいキーへ移行し、次回からはv4を使用する。
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        }
      }
    } catch (e) {
      console.error(
        '保存データの読み込みに失敗しました',
        e
      );
    }

    // 起動時はブラウザに保存済みのデータだけを表示する。
    // Smashmateへはアクセスしない。GitHubバックアップは必要なときに手動で読み込む。
    localStorage.setItem('ningyogeki-offline-mode', 'true');
    setCharacterProgress({
      done: savedData?.tournaments?.length || 0,
      total: savedData?.tournaments?.length || 0,
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ningyogeki-selected-player', selected);
    } catch (e) {
      console.error('選択中の選手の保存に失敗しました', e);
    }
  }, [selected]);

  async function syncToOverlay(payload = data) {
    if (!payload) return;
    setOverlaySyncStatus('ローカル連携へ同期中…');
    try {
      const response = await fetch('http://127.0.0.1:4173/api/sync-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }
      setOverlaySyncStatus(`ローカル連携へ同期済み（${result.tournaments}大会）`);
    } catch (e) {
      console.warn('ローカル連携への同期に失敗しました', e);
      setOverlaySyncStatus('ローカル連携サーバーに接続できません。起動後に再試行してください。');
    }
  }

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

    syncToOverlay(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function exportArchive() {
    if (!data) return;

    let savedData = data;
    let savedCharacterComments = Array.isArray(characterComments) ? characterComments : [];

    try {
      const storedData =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem('ningyogeki-stats-v3');
      if (storedData) savedData = JSON.parse(storedData);
    } catch (e) {
      console.warn('保存済み戦績の読み取りに失敗しました。画面上のデータを出力します。', e);
    }

    try {
      const storedComments = localStorage.getItem('ningyogeki-character-comments-v7');
      if (storedComments) savedCharacterComments = JSON.parse(storedComments);
    } catch (e) {
      console.warn('保存済みコメントの読み取りに失敗しました。画面上のデータを出力します。', e);
    }

    const archive = {
      archiveFormat: 'ningyogeki-stats-archive',
      archiveVersion: 1,
      exportedAt: new Date().toISOString(),
      source: 'https://ningyogeki-stats.vercel.app/',
      description: '人形劇戦績サイトのローカル保存用アーカイブ。元データを保持し、再集計できるようにする。',
      data: savedData,
      characterComments: savedCharacterComments,
      manualCharacterReports: MANUAL_CHARACTER_REPORTS,
      characterAliases: CHARACTER_ALIASES,
      notes: [
        'dataにはエクスポート時点でブラウザに保存されていた大会・選手・対戦記録が含まれます。',
        'characterCommentsは取得済みコメントのキャッシュです。未取得大会のコメントは含まれません。',
        '手動登録キャラ報告と表記ゆれ辞書は、当時の集計結果を再現するために含めています。',
      ],
    };

    const blob = new Blob([JSON.stringify(archive, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toLocaleDateString('sv-SE');
    link.href = url;
    link.download = `ningyogeki-archive-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importArchive(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const archive = JSON.parse(await file.text());
      if (archive?.archiveFormat !== 'ningyogeki-stats-archive' ||
          !archive?.data?.players || !archive?.data?.tournaments ||
          !archive?.data?.records) {
        throw new Error('人形劇戦績サイトのバックアップJSONではありません。');
      }
      const importedData = archive.data;
      const message = 'バックアップを読み込みます。大会：' +
        importedData.tournaments.length + '件、対戦記録：' +
        importedData.records.length + '件。現在の保存データを置き換えます。よろしいですか？';
      if (!window.confirm(message)) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(importedData));
      if (Array.isArray(archive.characterComments)) {
        localStorage.setItem('ningyogeki-character-comments-v7', JSON.stringify(archive.characterComments));
        setCharacterComments(archive.characterComments);
      }
      localStorage.setItem('ningyogeki-offline-mode', 'true');
      setData(importedData);
      setOfflineMode(true);
      setSelected('all');
      setSeason('current');
      setMatrixSeason('current');
      setError('');
      setCharacterError('');
      setCharacterCacheLoaded(true);
      setCharacterProgress({ done: importedData.tournaments.length, total: importedData.tournaments.length });
      setOverlaySyncStatus('バックアップを読み込みました。オフラインモード中はSmashmateへ接続しません。');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'バックアップを読み込めませんでした。');
    }
  }

  async function loadGitHubArchive() {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/data/ningyogeki-archive.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('GitHubに保存したバックアップを取得できませんでした。');
      const archive = await response.json();
      if (archive?.archiveFormat !== 'ningyogeki-stats-archive' ||
          !archive?.data?.players || !archive?.data?.tournaments ||
          !archive?.data?.records) {
        throw new Error('GitHub上のJSONが人形劇戦績サイトのバックアップ形式ではありません。');
      }
      const importedData = archive.data;
      const message = 'GitHubのバックアップを読み込みます。大会：' +
        importedData.tournaments.length + '件、対戦記録：' +
        importedData.records.length + '件。現在の保存データを置き換えます。よろしいですか？';
      if (!window.confirm(message)) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(importedData));
      if (Array.isArray(archive.characterComments)) {
        localStorage.setItem('ningyogeki-character-comments-v7', JSON.stringify(archive.characterComments));
        setCharacterComments(archive.characterComments);
      }
      localStorage.setItem('ningyogeki-offline-mode', 'true');
      setData(importedData);
      setOfflineMode(true);
      setSelected('all');
      setSeason('current');
      setMatrixSeason('current');
      setError('');
      setCharacterError('');
      setCharacterCacheLoaded(true);
      setCharacterProgress({ done: importedData.tournaments.length, total: importedData.tournaments.length });
      setOverlaySyncStatus('GitHubのバックアップを読み込みました。オフラインモード中はSmashmateへ接続しません。');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GitHubのバックアップを読み込めませんでした。');
    } finally {
      setLoading(false);
    }
  }

  const playerTournamentStats = useMemo(() => {
    const appearances = new Map();
    const wins = new Map();
    const champions = new Map();
    const recordsByTournament = new Map();

    for (const record of data?.records || []) {
      const number = Number(record.tournamentNumber);
      if (!Number.isFinite(number)) continue;
      if (!recordsByTournament.has(number)) recordsByTournament.set(number, []);
      recordsByTournament.get(number).push(record);

      for (const id of [record.winnerId, record.loserId]) {
        const key = String(id);
        if (!appearances.has(key)) appearances.set(key, new Set());
        appearances.get(key).add(number);
      }
    }

    for (const [number, records] of recordsByTournament) {
      const losers = new Set(records.map((record) => String(record.loserId)));
      const participants = new Set(records.flatMap((record) => [
        String(record.winnerId),
        String(record.loserId),
      ]));
      const unbeaten = [...participants].filter((id) => !losers.has(id));
      if (unbeaten.length === 1) {
        const key = unbeaten[0];
        champions.set(number, key);
        wins.set(key, (wins.get(key) || 0) + 1);
      }
    }

    return { appearances, wins, champions, recordsByTournament };
  }, [data]);

  const sortedPlayers = useMemo(
    () =>
      data
        ? [...data.players].sort((a, b) => {
            const appearancesA = playerTournamentStats.appearances.get(String(a.id))?.size || 0;
            const appearancesB = playerTournamentStats.appearances.get(String(b.id))?.size || 0;
            const winsA = playerTournamentStats.wins.get(String(a.id)) || 0;
            const winsB = playerTournamentStats.wins.get(String(b.id)) || 0;
            return appearancesB - appearancesA ||
              winsB - winsA ||
              String(a.name).localeCompare(String(b.name), 'ja');
          })
        : [],
    [data, playerTournamentStats]
  );

  const filteredPlayers = useMemo(() => {
    const query = playerSearch.trim().toLocaleLowerCase('ja');
    if (!query) return sortedPlayers;
    return sortedPlayers.filter((player) =>
      String(player.name).toLocaleLowerCase('ja').includes(query) ||
      String(player.id).includes(query)
    );
  }, [sortedPlayers, playerSearch]);

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

  // 同じデータに対するシーズン別Elo計算を共有し、重複計算を避ける。
  const getEloResult = useMemo(() => {
    const cache = new Map();
    return (targetSeason) => {
      const key = String(targetSeason);
      if (!cache.has(key)) {
        cache.set(key, calculateElo(data, key));
      }
      return cache.get(key);
    };
  }, [data]);

  const tournamentTierScores = useMemo(
    () => calculateTournamentTierScores(data, getEloResult),
    [data, getEloResult]
  );

  const tournamentChampions = useMemo(() => {
    const playerNames = new Map(
      (data?.players || []).map((player) => [String(player.id), player.name])
    );
    const champions = new Map();

    for (const [number, records] of playerTournamentStats.recordsByTournament) {
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
  }, [data, playerTournamentStats]);

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
    () => getEloResult(selectedSeason),
    [getEloResult, selectedSeason]
  );

  // Eloはここで1回だけ計算し、
  // ランキングはその最終結果を並べるだけにする。
  const ranking = eloResult.ranking;
  const matchHistory = eloResult.history;

  const matrixSelectedSeason = matrixSeason === 'current' ? currentSeason : matrixSeason;

  const matrixStats = useMemo(() => {
    if (matrixSeason === 'all') return data?.stats || {};
    const firstTournament = (Number(matrixSelectedSeason) - 1) * 25 + 1;
    const lastTournament = Number(matrixSelectedSeason) * 25;
    const stats = {};

    for (const record of data?.records || []) {
      const tournamentNumber = Number(record.tournamentNumber) || 0;
      if (tournamentNumber < firstTournament || tournamentNumber > lastTournament) continue;

      const winnerId = String(record.winnerId);
      const loserId = String(record.loserId);
      if (!stats[winnerId]) stats[winnerId] = {};
      if (!stats[loserId]) stats[loserId] = {};
      if (!stats[winnerId][loserId]) stats[winnerId][loserId] = { wins: 0, losses: 0 };
      if (!stats[loserId][winnerId]) stats[loserId][winnerId] = { wins: 0, losses: 0 };
      stats[winnerId][loserId].wins += 1;
      stats[loserId][winnerId].losses += 1;
    }

    for (const playerStats of Object.values(stats)) {
      for (const stat of Object.values(playerStats)) {
        const total = stat.wins + stat.losses;
        stat.rate = total ? Math.round((stat.wins / total) * 1000) / 10 : 0;
      }
    }
    return stats;
  }, [data, matrixSeason, matrixSelectedSeason]);

  const matrixPlayers = useMemo(() => {
    const participantIds = matrixSeason === 'all'
      ? new Set(playerTournamentStats.appearances.keys())
      : new Set(Object.keys(matrixStats));
    return sortedPlayers.filter((player) => participantIds.has(String(player.id)));
  }, [matrixSeason, sortedPlayers, playerTournamentStats, matrixStats]);


  const selectedPlayer = data?.players.find(
    (player) =>
      String(player.id) === String(selected)
  );

  const selectedAchievements = useMemo(
    () => getPlayerAchievements(data, selected, playerTournamentStats.champions),
    [data, selected, playerTournamentStats]
  );

  const selectedCharacterStats = useMemo(() => {
    const characterTargetPlayer = data?.players?.find((player) => String(player.id) === String(selected));
    if (!characterTargetPlayer || !characterComments) return { counts: [], total: 0, tournaments: 0 };
    const counts = new Map();
    const seenTournaments = new Set();
    const reportedByTournament = new Map();
    let matchedComments = 0;
    let parsedComments = 0;
    const targetCanonicalId = canonicalAccountId(characterTargetPlayer.id);
    const targetNormalizedName = normalizePlayerName(characterTargetPlayer.name);
    // いぶ選手の過去大会は手動登録を優先し、同じ大会のコメント集計と二重計上しない。
    const manualReportsByTournament = new Map();
    const tournamentsByNormalizedName = new Map();
    const tournamentsByNumber = new Map();
    for (const tournament of data.tournaments || []) {
      const normalizedName = normalizeTournamentName(tournament.name);
      if (!tournamentsByNormalizedName.has(normalizedName)) {
        tournamentsByNormalizedName.set(normalizedName, tournament);
      }
      const number = Number(tournament.number);
      if (Number.isFinite(number) && !tournamentsByNumber.has(number)) {
        tournamentsByNumber.set(number, tournament);
      }
    }
    {
      for (const report of MANUAL_CHARACTER_REPORTS) {
        // playerId なしの既存手動データは「いぶ」専用。playerId ありは指定選手だけに適用。
        if (report.playerId
          ? canonicalAccountId(report.playerId) !== targetCanonicalId
          : targetCanonicalId !== '81727') continue;
        const reportName = String(report.tournamentName || '');
        let tournament = tournamentsByNormalizedName.get(normalizeTournamentName(reportName));
        if (!tournament) {
          const numberMatch = reportName.match(/人形劇\s*#?\s*(\d+)/u);
          if (numberMatch) {
            tournament = tournamentsByNumber.get(Number(numberMatch[1]));
          }
        }
        const number = Number(tournament?.number);
        if (!Number.isFinite(number)) continue;
        const characters = [...new Set(
          (Array.isArray(report.characters) ? report.characters : [])
            .map((name) => String(name || '').trim())
            .filter(Boolean)
        )];
        // 空欄のテンプレート行はコメント集計を止めない。キャラが入力済みの大会だけ手動登録を優先する。
        if (characters.length > 0) manualReportsByTournament.set(number, characters);
      }
    }
    for (const tournament of characterComments) {
      // 過去大会を手動登録している場合、その大会のコメントは集計対象から外す。
      if (manualReportsByTournament.has(Number(tournament.number))) continue;
      const usedInTournament = new Set();
      for (const comment of tournament.comments || []) {
        const commentUserId = String(comment.userId || '').trim();
        const matchesById =
          Boolean(commentUserId) &&
          canonicalAccountId(commentUserId) === targetCanonicalId;
        // コメントHTMLの形式によって投稿者IDが取得できない場合に限り、名前の完全一致で補完する。
        // IDが取得できているコメントは、従来どおりIDを優先して誤判定を避ける。
        // IDが一致しない場合も、投稿者名が正規化後に完全一致するなら同一選手として扱う。
        // 旧アカウントIDなどで登録IDとコメントIDが異なるケースを取りこぼさない。
        const matchesByName =
          normalizePlayerName(comment.name) === targetNormalizedName;
        if (!matchesById && !matchesByName) continue;
        matchedComments += 1;
        let remainingText = String(comment.text || '').normalize('NFKC');
        // 正式名と辞書の別表記を同じ正式名に統一してから、大会ごとに重複を除く。
        for (const pattern of characterPatterns) {
          const foundAt = findExactName(remainingText, pattern.match);
          if (foundAt !== -1) {
            if (!usedInTournament.has(pattern.officialName)) {
              counts.set(pattern.officialName, (counts.get(pattern.officialName) || 0) + 1);
              parsedComments += 1;
              usedInTournament.add(pattern.officialName);
              seenTournaments.add(Number(tournament.number));
            }
            remainingText = removeExactName(remainingText, pattern.match);
          }
        }
      }
      if (usedInTournament.size) reportedByTournament.set(Number(tournament.number), new Set([...(reportedByTournament.get(Number(tournament.number)) || []), ...usedInTournament]));
    }
    for (const [number, characters] of manualReportsByTournament) {
      const used = new Set();
      for (const character of characters) {
        used.add(character);
        counts.set(character, (counts.get(character) || 0) + 1);
      }
      if (used.size) {
        seenTournaments.add(number);
        reportedByTournament.set(number, used);
      }
    }
    // 参加大会・優勝集計で作成した大会別記録を再利用する。
    // キャラクター単騎判定では、各記録のIDを canonical 化してから判定する。
    const champions = new Map();
    for (const [number, records] of playerTournamentStats.recordsByTournament) {
      // 同一選手の旧IDと統合後IDが混在していても、同一選手として優勝判定する。
      const losers = new Set(records.map((record) => canonicalAccountId(record.loserId)));
      const participants = new Set(
        records.flatMap((record) => [
          canonicalAccountId(record.winnerId),
          canonicalAccountId(record.loserId),
        ])
      );
      const unbeaten = [...participants].filter((id) => !losers.has(id));
      if (unbeaten.length === 1) champions.set(number, unbeaten[0]);
    }
    const playerId = targetCanonicalId;
    const soloAchievements = [...reportedByTournament.entries()]
      .filter(([number, characters]) => champions.get(number) === playerId && characters.size === 1)
      .map(([number, characters]) => ({ number, character: [...characters][0] }))
      .sort((a, b) => b.number - a.number);
    return { counts: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja')), total: [...counts.values()].reduce((sum, value) => sum + value, 0), tournaments: seenTournaments.size, soloAchievements, matchedComments, parsedComments, targetId: String(characterTargetPlayer.id), fetchedComments: characterComments.reduce((sum, item) => sum + (item.comments?.length || 0), 0), fetchErrors: characterComments.filter((item) => item.error).length };
  }, [data, selected, characterComments, playerTournamentStats]);

  const recentResultsByOpponent = useMemo(() => {
    const results = new Map();
    if (!data?.records || !selectedPlayer) return results;

    const playerId = String(selectedPlayer.id);
    for (const record of data.records) {
      if (record?.winnerId == null || record?.loserId == null) continue;
      const winnerId = String(record.winnerId);
      const loserId = String(record.loserId);
      let opponentId;
      let result;

      if (winnerId === playerId) {
        opponentId = loserId;
        result = 'W';
      } else if (loserId === playerId) {
        opponentId = winnerId;
        result = 'L';
      } else {
        continue;
      }

      if (!results.has(opponentId)) results.set(opponentId, []);
      results.get(opponentId).push({
        result,
        tournamentNumber: Number(record.tournamentNumber) || 0,
      });
    }

    for (const [opponentId, matches] of results) {
      results.set(
        opponentId,
        matches
          .sort((a, b) => b.tournamentNumber - a.tournamentNumber)
          .slice(0, 5)
      );
    }

    return results;
  }, [data, selectedPlayer]);

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

    // 選択中の選手に関係する試合だけを1回の走査でまとめる。
    // 選手ごとに全履歴を再検索しない。履歴の順序と採用条件は従来どおり。
    const selectedIds = new Set(chartPlayerIds.map((id) => String(id)));
    const matchesByPlayer = new Map();
    const seasonMatchCounts = new Map();

    for (const match of matchHistory) {
      const tournamentNumber = Number(match.tournamentNumber) || 0;
      const isInSeason =
        selectedSeason !== 'all' &&
        tournamentNumber >= (Number(selectedSeason) - 1) * 25 + 1 &&
        tournamentNumber < (Number(selectedSeason) - 1) * 25 + 26;

      const winnerId = String(match.winnerId);
      if (selectedIds.has(winnerId)) {
        if (isInSeason) {
          seasonMatchCounts.set(winnerId, (seasonMatchCounts.get(winnerId) || 0) + 1);
        } else if (!seasonMatchCounts.has(winnerId)) {
          seasonMatchCounts.set(winnerId, 0);
        }
        if (match.winnerAfter != null) {
          if (!matchesByPlayer.has(winnerId)) matchesByPlayer.set(winnerId, []);
          matchesByPlayer.get(winnerId).push({
            tournamentNumber,
            rating: match.winnerAfter,
            match,
          });
        }
      }

      const loserId = String(match.loserId);
      if (selectedIds.has(loserId) && loserId !== winnerId) {
        if (isInSeason) {
          seasonMatchCounts.set(loserId, (seasonMatchCounts.get(loserId) || 0) + 1);
        } else if (!seasonMatchCounts.has(loserId)) {
          seasonMatchCounts.set(loserId, 0);
        }
        if (match.loserAfter != null) {
          if (!matchesByPlayer.has(loserId)) matchesByPlayer.set(loserId, []);
          matchesByPlayer.get(loserId).push({
            tournamentNumber,
            rating: match.loserAfter,
            match,
          });
        }
      }
    }

    return chartPlayerIds.map((rateChartPlayer, playerIndex) => {

    const playerId = String(rateChartPlayer);
    const playerMatches = matchesByPlayer.get(playerId) || [];

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
          seasonMatchCounts.get(String(id)) || 0
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

            <h2>保存済みデータがありません</h2>

            <p>
              GitHubのバックアップを読み込むか、保存済みのバックアップJSONを選択してください。
              Smashmateへのアクセスは行いません。
            </p>

            <button
              className="primary"
              onClick={loadGitHubArchive}
              disabled={loading}
            >
              GitHubのバックアップを読み込む
            </button>
            <button
              className="secondary"
              onClick={() => archiveInputRef.current?.click()}
              disabled={loading}
            >
              バックアップJSONを読み込む
            </button>
            <input
              ref={archiveInputRef}
              type="file"
              accept="application/json,.json"
              onChange={importArchive}
              style={{ display: 'none' }}
            />

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
            <button
              type="button"
              className={`playerSearchToggle ${playerSearchOpen ? 'isActive' : ''}`}
              aria-label={playerSearchOpen ? '選手検索を閉じる' : '選手を検索'}
              aria-expanded={playerSearchOpen}
              onClick={() => {
                setPlayerSearchOpen((open) => {
                  if (open) setPlayerSearch('');
                  return !open;
                });
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.8" cy="10.8" r="6.5" />
                <path d="m16 16 4.2 4.2" />
              </svg>
            </button>
            {playerSearchOpen ? (
              <input
                id="playerSearch"
                className="playerSearchInput playerSearchInline"
                type="search"
                value={playerSearch}
                onChange={(e) => {
                  const nextQuery = e.target.value;
                  setPlayerSearch(nextQuery);
                  const query = nextQuery.trim().toLocaleLowerCase('ja');
                  if (!query) return;
                  const matches = sortedPlayers.filter((player) =>
                    String(player.name).toLocaleLowerCase('ja').includes(query) ||
                    String(player.id).includes(query)
                  );
                  const exactMatch = sortedPlayers.find(
                    (player) => String(player.name).toLocaleLowerCase('ja') === query
                  );
                  if (exactMatch) {
                    setSelected(String(exactMatch.id));
                  } else if (matches.length === 1) {
                    setSelected(String(matches[0].id));
                  }
                }}
                placeholder="選手名を入力…"
                autoComplete="off"
                autoFocus
              />
            ) : (
              <select
                id="playerSelect"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="all">全体（全選手）</option>
                {sortedPlayers.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
            )}
            {playerSearchOpen && playerSearch.trim() && (
              <div className="playerSearchCount">
                {filteredPlayers.length}人が一致
              </div>
            )}
          </div>


          {selected !== 'all' && selectedPlayer && (
            <div className="achievementPanel">
              <div className="achievementItem characterUsageItem">
                {characterComments && <>
                  {selectedCharacterStats.counts.length > 0 ? <>
                    <div className="characterUsageGrid">
                      <section className="characterUsageSection">
                        <span className="characterSectionTitle">メインファイター</span>
                        <div className="characterTopList">{selectedCharacterStats.counts.slice(0, 5).map((item) => <div className="characterTopCard" key={item.name}>{item.name}</div>)}</div>
                      </section>
                      {selectedCharacterStats.soloAchievements?.length > 0 && <section className="characterUsageSection characterSoloSection"><span className="characterSectionTitle">単騎達成</span><div className="characterSoloList">{[...selectedCharacterStats.soloAchievements.reduce((grouped, item) => { if (!grouped.has(item.character)) grouped.set(item.character, []); grouped.get(item.character).push(item.number); return grouped; }, new Map())].map(([character, numbers]) => <div className="characterSoloEntry" key={character}><div className="characterSoloEntryHead"><button type="button" className="characterSoloCard" aria-expanded={expandedSoloCharacters.includes(character)} onClick={() => setExpandedSoloCharacters((current) => current.includes(character) ? current.filter((item) => item !== character) : [...current, character])}><strong>{character}</strong></button>{numbers.length > 1 && <span className="characterSoloCount">×{numbers.length}</span>}</div>{expandedSoloCharacters.includes(character) && <div className="characterSoloNumbers" aria-label={character + 'の達成大会'}>{numbers.map((number) => <span key={number}>#{number}</span>)}</div>}</div>)}</div></section>}
                    </div>
                  </> : <p>この選手のコメントからキャラ報告を確認できませんでした。</p>}
                </>}
                {characterError && <p className="error">{characterError}</p>}
              </div>

              <div className="achievementItem titleItem">
                <span>優勝した大会（全期間）</span>
                {selectedAchievements.titleNumbers.length ? (
                  <>
                  <div className={"achievementTournaments " + (selectedAchievements.titleNumbers.length > 6 && !showAllTitles ? "achievementTournamentsCollapsed" : "")}>
                    {selectedAchievements.titleNumbers.map((number) => {
                      const score = Number(tournamentTierScores[Number(number)] || 0);
                      const tier = score >= 24000 ? 'S' : score >= 20000 ? 'A' : score >= 16000 ? 'B' : score >= 12000 ? 'C' : 'D';
                      return (
                        <span className="achievementTournament" key={number}>
                          <b className={`achievementTier tier${tier}`}><span className="tierLetter">{tier}</span></b>
                          <span>人形劇#{number}</span>
                        </span>
                      );
                    })}
                  </div>
                  {selectedAchievements.titleNumbers.length > 6 && (
                    <button type="button" className="achievementTournamentsToggle" onClick={() => setShowAllTitles(!showAllTitles)} aria-expanded={showAllTitles}>
                      {showAllTitles ? '閉じる ▲' : 'すべて表示 ▼'}
                    </button>
                  )}
                  <div className="achievementTierCounts">
                    {['S', 'A', 'B', 'C', 'D'].map((tier) => {
                      const count = selectedAchievements.titleNumbers.filter((number) => {
                        const score = Number(tournamentTierScores[Number(number)] || 0);
                        const wonTier = score >= 24000 ? 'S' : score >= 20000 ? 'A' : score >= 16000 ? 'B' : score >= 12000 ? 'C' : 'D';
                        return wonTier === tier;
                      }).length;
                      return (
                        <span key={tier}>
                          <b className={`achievementTier tier${tier}`}>{tier}</b>
                          ×{count}
                        </span>
                      );
                    })}
                  </div>
                  </>
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
                <small>出場大会：{selectedAchievements.playedStreak}連覇</small>
              </div>
            </div>
          )}

          {selected === 'all' && (
            <div className="matrixSeasonControl">
              <div className="seasonTabs" aria-label="対戦表のシーズン">
                <button className={matrixSeason === 'current' ? 'active' : ''} onClick={() => setMatrixSeason('current')}>現在</button>
                <button className={matrixSeason === 'all' ? 'active' : ''} onClick={() => setMatrixSeason('all')}>すべて</button>
                {seasons.map((s) => (
                  <button key={s.key} className={matrixSeason === s.key ? 'active' : ''} onClick={() => setMatrixSeason(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selected === 'all' ? (
            <div className="matrixWrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>PLAYER</th>

                    {matrixPlayers.map(
                      (player) => (
                        <th key={player.id}>
                          {player.name}
                        </th>
                      )
                    )}
                  </tr>
                </thead>

                <tbody>
                  {matrixPlayers.map((row) => (
                    <tr key={row.id}>
                      <th>{row.name}</th>

                      {matrixPlayers.map(
                        (col) => {
                          const stat =
                            matrixStats?.[
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
                            {(recentResultsByOpponent.get(String(player.id)) || []).map((result, index) => (
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
                RATE RANKING
              </div>

              <h2>
                レートランキング
              </h2>

              <p>
                25大会ごとにシーズンを区切り、レートを算出します。各シーズン1500から開始し、1試合ごとに更新します。RDはシーズンをまたいで引き継ぎ、長期間プレイしていない場合は経過期間に応じて増加します。相手のRDが自分より高い場合、シーズン別ランキングではRD差200以上で勝利時の獲得量を最大1.5倍にし、敗北時の減少量はRD差に応じて最大0.25倍に抑えます。「すべて」のランキングではRD差による勝利ボーナスを適用しません。
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
              <p className="tierExplanation">
                Tier区分：
                <span>S：24,000以上</span>
                <span>A：20,000以上</span>
                <span>B：16,000以上</span>
                <span>C：12,000以上</span>
                <span>D：12,000未満</span>
              </p>
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
                            <span className={`tierBadge tier${tier}`}><span className="tierLetter">{tier}</span></span>
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
                    {tournament.players}人
                  </span>
                </div>
              ))}
          </div>
        </section>

        {/* バックアップ管理 */}
        <section className="control card" style={{ marginTop: '18px' }}>
          <div>
            <h2>データ管理</h2>

            <p>
              起動時はこのブラウザの保存済みデータを使用します。必要なときだけGitHubまたはJSONのバックアップを読み込めます。
            </p>
          </div>

          <div className="buttonGroup">
            <button
              className="secondary"
              onClick={() => syncToOverlay()}
              disabled={!data}
            >
              ローカル連携へ同期
            </button>

            <button
              className="secondary"
              onClick={exportArchive}
              disabled={!data}
            >
              全データを保存（JSON）
            </button>

            <button
              className="secondary"
              onClick={loadGitHubArchive}
              disabled={loading}
            >
              GitHubのバックアップを読み込む
            </button>

            <button
              className="secondary"
              onClick={() => archiveInputRef.current?.click()}
            >
              バックアップJSONを読み込む
            </button>
            <input
              ref={archiveInputRef}
              type="file"
              accept="application/json,.json"
              onChange={importArchive}
              style={{ display: 'none' }}
            />

          </div>

          <div className="hint">
            保存済みデータとバックアップだけを使用します。Smashmateへの通信は行いません。
          </div>
          <div className="hint" role="status" aria-live="polite">
            {overlaySyncStatus}
          </div>
        </section>

        <footer>
          NINGYOGEKI STATS <span>—</span>{' '}
          Historical tournament results
        </footer>
      </div>
    </main>
  );
}
