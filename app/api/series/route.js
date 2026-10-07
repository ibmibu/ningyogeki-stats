import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const USER_ID = 81727;
const UA = 'Mozilla/5.0 (compatible; NingyogekiStats/1.0)';
const CONCURRENCY = 8;

async function html(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA },
    cache: 'no-store'
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

// いぶさんの参加大会一覧から「人形劇#数字」だけを拾う。
async function discoverFromUserPage() {
  const url = `${BASE}/user_add_tournament/?user=${USER_ID}`;
  const $ = cheerio.load(await html(url));
  const found = new Map();

  $('a[href^="/tournament/"]').each((_, e) => {
    const href = $(e).attr('href') || '';
    const text = $(e).text().replace(/\s+/g, ' ').trim();
    const id = href.match(/^\/tournament\/(\d+)\/?$/)?.[1];
    const number = text.match(/人形劇#(\d+)/)?.[1];
    if (!id || !number) return;
    found.set(Number(number), {
      number: Number(number),
      tournamentUrl: `${BASE}/tournament/${id}/`,
      bracketUrl: `${BASE}/bracket/${id}/`
    });
  });

  return [...found.values()].sort((a, b) => a.number - b.number);
}

function parseBracket(h, fallback) {
  const $ = cheerio.load(h);
  const players = new Map();
  const records = [];
  const title = $('title').text().replace('のトーナメント表 スマメイト', '').trim();
  const tournamentName = title || fallback;

  $('[data-round] .tour_div_in').each((_, group) => {
    const boxes = $(group).find('.tour_user_box').toArray();
    if (boxes.length !== 2) return;

    const pair = boxes.map((el) => ({
      id: $(el).attr('data-uid'),
      name: $(el).find('.tour_user_name').text().trim(),
      result: Number($(el).attr('data-result'))
    }));

    if (pair.some((p) => !p.id || !p.name || !p.result)) return;
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
      try {
        out[index] = await fn(items[index], index);
      } catch (error) {
        out[index] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET() {
  try {
    const tournaments = await discoverFromUserPage();

    const results = await mapWithConcurrency(tournaments, CONCURRENCY, async (t) => {
      const parsed = parseBracket(
        await html(t.bracketUrl),
        `人形劇#${t.number}`
      );
      return { ...t, ...parsed };
    });

    const allPlayers = new Map();
    const stats = {};
    const records = [];
    const done = [];
    const failed = [];

    results.forEach((result, index) => {
      const source = tournaments[index];
      if (!result || result.error) {
        failed.push({
          number: source.number,
          error: result?.error || '取得に失敗しました'
        });
        return;
      }

      result.players.forEach((p) => allPlayers.set(p.id, p));
      addStats(stats, result.records);

      result.records.forEach((record) => {
        records.push({
          ...record,
          tournamentNumber: source.number,
          tournament: result.tournamentName
        });
      });

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

    return Response.json({
      seriesName: '人形劇',
      source: `${BASE}/user_add_tournament/?user=${USER_ID}`,
      tournaments: done.sort((a, b) => a.number - b.number),
      players: [...allPlayers.values()],
      records,
      matches: records.length,
      stats,
      discoveredOnUserPage: tournaments.length,
      failed
    });
  } catch (error) {
    return Response.json(
      {
        error: '人形劇シリーズの取得に失敗しました。',
        detail: error instanceof Error ? error.message : String(error)
      },
      { status: 502 }
    );
  }
}
