import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const USER_ID = 81727;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const CONCURRENCY = 3;

// 同一人物の別アカウントをまとめたい場合、
// 「旧アカウントUID: 現在まとめたいUID」の形で追加してください。
// 例: { '12345': '67890' }
const ACCOUNT_ALIASES = {
  // 同一人物の別アカウントを統合（各グループ内で最新UID側へ寄せる）
  '99450': '145071',
  '118591': '149650',
  '148400': '164481',
  '80108': '142959',
  '100389': '167992',
  '159344': '167992',
  '156108': '156414',
};

function canonicalId(id) {
  let current = String(id);
  const seen = new Set();
  while (ACCOUNT_ALIASES[current] && !seen.has(current)) {
    seen.add(current);
    current = String(ACCOUNT_ALIASES[current]);
  }
  return current;
}

async function html(url, referer = BASE + '/') {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          'Referer': referer
        },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      lastError = e;
      if (attempt < 2) await new Promise(r => setTimeout(r, 700));
    }
  }
  throw new Error(`${lastError?.message || '取得失敗'}: ${url}`);
}

async function discoverFromUserPage() {
  const userUrl = `${BASE}/user_add_tournament/?user=${USER_ID}`;
  const $ = cheerio.load(await html(userUrl));
  const found = new Map();

  $('a[href*="/tournament/"]').each((_, e) => {
    const href = $(e).attr('href') || '';
    const text = $(e).text().replace(/\s+/g, ' ').trim();
    const id = href.match(/\/tournament\/(\d+)\/?/)?.[1];
    const number = text.match(/人形劇\s*#\s*(\d+)/)?.[1];
    if (!id || !number) return;
    found.set(Number(number), {
      number: Number(number),
      tournamentId: id,
      tournamentUrl: `${BASE}/tournament/${id}/`
    });
  });

  return [...found.values()].sort((a, b) => a.number - b.number);
}

async function findBracketUrl(tournament) {
  const page = await html(tournament.tournamentUrl, `${BASE}/user_add_tournament/?user=${USER_ID}`);
  const $ = cheerio.load(page);
  let href = '';
  $('a[href*="/bracket/"]').each((_, e) => {
    const h = $(e).attr('href') || '';
    if (!href && /\/bracket\/\d+\/?/.test(h)) href = h;
  });
  const id = href.match(/\/bracket\/(\d+)\/?/)?.[1];
  if (!id) throw new Error('トーナメント表（bracket）のURLが見つかりません');
  return `${BASE}/bracket/${id}/`;
}

function parseBracket(h, fallback) {
  const $ = cheerio.load(h);
  const players = new Map();
  const records = [];

  const title = $('title').text().replace(/のトーナメント表\s*スマメイト.*/u, '').trim();
  const tournamentName = title || fallback;

  $('.tour_div_in').each((_, group) => {
    const boxes = $(group).find('.tour_user_box').toArray();
    if (boxes.length !== 2) return;

    const pair = boxes.map((el) => ({
      id: $(el).attr('data-uid'),
      name: $(el).find('.tour_user_name').text().replace(/\s+/g, ' ').trim(),
      result: Number($(el).attr('data-result'))
    }));

    if (pair.some((p) => !p.id || !p.name || ![1, 2].includes(p.result))) return;
    pair.forEach((p) => players.set(p.id, { id: p.id, name: p.name }));

    const winner = pair.find((p) => p.result === 1);
    const loser = pair.find((p) => p.result === 2);
    if (!winner || !loser) return;

    records.push({
      winner: winner.name,
      loser: loser.name,
      winnerId: winner.id,
      loserId: loser.id,
      round: $(group).closest('[data-round]').attr('data-round') || ''
    });
  });

  return { tournamentName, players: [...players.values()], records };
}

function normalizeRecords(records) {
  return records.map((r) => ({
    ...r,
    winnerId: canonicalId(r.winnerId),
    loserId: canonicalId(r.loserId)
  }));
}

function addStats(stats, records) {
  for (const r of records) {
    stats[r.winnerId] ??= {};
    stats[r.loserId] ??= {};
    stats[r.winnerId][r.loserId] ??= { wins: 0, losses: 0 };
    stats[r.loserId][r.winnerId] ??= { wins: 0, losses: 0 };
    stats[r.winnerId][r.loserId].wins++;
    stats[r.loserId][r.winnerId].losses++;
  }
}

function finishStats(stats) {
  for (const a of Object.keys(stats)) {
    for (const b of Object.keys(stats[a])) {
      const s = stats[a][b];
      const total = s.wins + s.losses;
      s.rate = total ? Math.round((s.wins / total) * 1000) / 10 : 0;
    }
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { out[index] = await fn(items[index], index); }
      catch (error) { out[index] = { error: error instanceof Error ? error.message : String(error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}


async function fetchCurrentPlayerName(player) {
  try {
    const page = await html(`${BASE}/user/${player.id}/`);
    const $ = cheerio.load(page);
    const heading = $('h1').first().text().replace(/\s+/g, ' ').trim();
    const m = heading.match(/^(.*?)さんのユーザーページ$/u);
    if (m && m[1].trim()) return { id: player.id, name: m[1].trim() };
    // Fallback: the user page has a "MATE ID" line and the name immediately
    // before it in the user-info area. Keep the bracket name if parsing fails.
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const beforeMate = bodyText.match(/ユーザー情報.*?\|\s*([^|]+?)\s*有線確認済み.*?MATE ID/);
    if (beforeMate && beforeMate[1].trim()) return { id: player.id, name: beforeMate[1].trim() };
  } catch (_) {}
  return { id: player.id, name: player.name };
}

async function refreshCurrentPlayerNames(players) {
  const refreshed = await mapWithConcurrency(players, 5, fetchCurrentPlayerName);
  return refreshed.map((p, i) => p?.error ? players[i] : p);
}

export async function GET() {
  try {
    const tournaments = await discoverFromUserPage();
    const results = await mapWithConcurrency(tournaments, CONCURRENCY, async (t) => {
      const bracketUrl = await findBracketUrl(t);
      const parsed = parseBracket(await html(bracketUrl, t.tournamentUrl), `人形劇#${t.number}`);
      return { ...t, bracketUrl, ...parsed };
    });

    const allPlayers = new Map();
    const stats = {};
    const records = [];
    const done = [];
    const failed = [];

    results.forEach((result, index) => {
      const source = tournaments[index];
      if (!result || result.error) {
        failed.push({ number: source.number, tournamentUrl: source.tournamentUrl, error: result?.error || '取得に失敗しました' });
        return;
      }
      result.players.forEach((p) => {
        const id = canonicalId(p.id);
        if (!allPlayers.has(id) || !ACCOUNT_ALIASES[p.id]) {
          allPlayers.set(id, { ...p, id });
        }
      });
      const normalized = normalizeRecords(result.records);
      addStats(stats, normalized);
      normalized.forEach((record) => records.push({ ...record, tournamentNumber: source.number, tournament: result.tournamentName }));
      done.push({
        number: source.number,
        name: result.tournamentName,
        tournamentUrl: source.tournamentUrl,
        bracketUrl: source.bracketUrl,
        matches: result.records.length,
        players: result.players.length
      });
    });

    finishStats(stats);

    // 統合先UIDだけが存在するケースでも現在名を取得できるようにする。
    for (const targetId of Object.values(ACCOUNT_ALIASES)) {
      const id = canonicalId(targetId);
      if (!allPlayers.has(id)) allPlayers.set(id, { id, name: id });
    }

    // Bracket pages preserve historical names. For display, refresh every UID
    // from the player's current Smashmate user page.
    const currentPlayers = await refreshCurrentPlayerNames([...allPlayers.values()]);
    const currentNameById = new Map(currentPlayers.map(p => [String(p.id), p.name]));
    for (const record of records) {
      record.winner = currentNameById.get(String(record.winnerId)) || record.winner;
      record.loser = currentNameById.get(String(record.loserId)) || record.loser;
    }
    for (const p of done) { /* tournament names are intentionally historical */ }

    return Response.json({
      seriesName: '人形劇',
      source: `${BASE}/user_add_tournament/?user=${USER_ID}`,
      tournaments: done.sort((a, b) => a.number - b.number),
      players: currentPlayers,
      records,
      matches: records.length,
      stats,
      discoveredOnUserPage: tournaments.length,
      failed
    });
  } catch (error) {
    return Response.json({
      error: '人形劇シリーズの取得に失敗しました。',
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 502 });
  }
}
