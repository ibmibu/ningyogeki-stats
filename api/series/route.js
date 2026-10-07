import * as cheerio from 'cheerio';
import { unstable_cache } from 'next/cache';

const BASE = 'https://smashmate.net';
const UA = 'Mozilla/5.0 (compatible; NingyogekiStats/1.0)';
const USER_ID = 81727;

async function html(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA
    },
    cache: 'no-store'
  });

  if (!r.ok) {
    throw Error(`${r.status} ${url}`);
  }

  return r.text();
}

function parseBracket(h, fallback) {
  const $ = cheerio.load(h);
  const players = new Map();
  const records = [];

  const name =
    $('title')
      .text()
      .replace('のトーナメント表 スマメイト', '')
      .trim() || fallback;

  $('[data-round] .tour_div_in').each((_, g) => {
    const boxes = $(g).find('.tour_user_box').toArray();

    if (boxes.length !== 2) return;

    const p = boxes.map(e => ({
      id: $(e).attr('data-uid'),
      name: $(e).find('.tour_user_name').text().trim(),
      result: Number($(e).attr('data-result'))
    }));

    if (
      !p[0].id ||
      !p[1].id ||
      !p[0].result ||
      !p[1].result
    ) {
      return;
    }

    p.forEach(x => {
      players.set(x.id, {
        id: x.id,
        name: x.name
      });
    });

    const winner = p.find(x => x.result === 1);
    const loser = p.find(x => x.result === 2);

    if (!winner || !loser) return;

    records.push({
      winner: winner.name,
      loser: loser.name,
      winnerId: winner.id,
      loserId: loser.id,
      round:
        $(g)
          .closest('[data-round]')
          .attr('data-round') || ''
    });
  });

  return {
    tournamentName: name,
    players: [...players.values()],
    records
  };
}

function add(stats, records) {
  for (const r of records) {
    stats[r.winnerId] ??= {};
    stats[r.loserId] ??= {};

    stats[r.winnerId][r.loserId] ??= {
      wins: 0,
      losses: 0
    };

    stats[r.loserId][r.winnerId] ??= {
      wins: 0,
      losses: 0
    };

    stats[r.winnerId][r.loserId].wins++;
    stats[r.loserId][r.winnerId].losses++;
  }
}

function finish(stats) {
  for (const a of Object.keys(stats)) {
    for (const b of Object.keys(stats[a])) {
      const s = stats[a][b];
      const total = s.wins + s.losses;

      s.rate = total
        ? Math.round((s.wins / total) * 1000) / 10
        : 0;
    }
  }
}

// ========================================
// ユーザーの参加大会一覧から
// 人形劇の大会を探す
// ========================================
async function discover() {
  const url =
    `${BASE}/user_add_tournament/?user=${USER_ID}`;

  const source = await html(url);
  const $ = cheerio.load(source);

  const found = [];

  $('a').each((_, e) => {
    const text = $(e)
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const match = text.match(/人形劇#(\d+)/);

    if (!match) return;

    const href = $(e).attr('href');

    if (!href) return;

    found.push({
      number: Number(match[1]),
      tournamentUrl: new URL(href, BASE).toString()
    });
  });

  const unique = new Map();

  for (const tournament of found) {
    unique.set(tournament.number, tournament);
  }

  return [...unique.values()].sort(
    (a, b) => a.number - b.number
  );
}

// ========================================
// 大会ページからトーナメント表URLを取得
// ========================================
async function resolve(tournament) {
  const source =
    await html(tournament.tournamentUrl);

  const $ = cheerio.load(source);

  let bracketUrl = null;

  $('a').each((_, e) => {
    const href = $(e).attr('href');

    if (
      !bracketUrl &&
      href &&
      href.includes('/bracket/')
    ) {
      bracketUrl =
        new URL(href, BASE).toString();
    }
  });

  if (!bracketUrl) {
    return null;
  }

  return {
    ...tournament,
    bracketUrl
  };
}

// ========================================
// 実際にSmashmateから全データを取得
// ========================================
async function buildSeriesData() {

  const found = await discover();

  console.log(
    '人形劇大会を発見:',
    found.length
  );

  const resolved = [];

  for (let i = 0; i < found.length; i += 3) {

    const batch = await Promise.all(
      found
        .slice(i, i + 3)
        .map(resolve)
    );

    resolved.push(
      ...batch.filter(Boolean)
    );
  }

  const tournaments =
    resolved.sort(
      (a, b) => a.number - b.number
    );

  const allPlayers = new Map();
  const stats = {};
  const records = [];
  const done = [];

  for (const tournament of tournaments) {

    try {

      const bracketHtml =
        await html(tournament.bracketUrl);

      const parsed =
        parseBracket(
          bracketHtml,
          `人形劇#${tournament.number}`
        );

      if (!parsed.records.length) {
        console.log(
          `人形劇#${tournament.number}: 試合なし`
        );

        continue;
      }

      parsed.players.forEach(player => {
        allPlayers.set(
          player.id,
          player
        );
      });

      add(
        stats,
        parsed.records
      );

      parsed.records.forEach(record => {
        records.push({
          ...record,
          tournamentNumber:
            tournament.number,
          tournament:
            parsed.tournamentName
        });
      });

      done.push({
        number: tournament.number,
        name: parsed.tournamentName,
        tournamentUrl:
          tournament.tournamentUrl,
        bracketUrl:
          tournament.bracketUrl,
        matches:
          parsed.records.length,
        players:
          parsed.players.length
      });

    } catch (error) {

      console.error(
        `人形劇#${tournament.number} 取得失敗`,
        error
      );

    }
  }

  finish(stats);

  return {
    seriesName: '人形劇',
    userId: USER_ID,
    tournaments: done,
    players: [...allPlayers.values()],
    records,
    matches: records.length,
    stats,
    discoveredOnListing: found.length,

    minTournament:
      found.length
        ? Math.min(
            ...found.map(x => x.number)
          )
        : null,

    maxTournament:
      found.length
        ? Math.max(
            ...found.map(x => x.number)
          )
        : null,

    note:
      'user_add_tournamentから人形劇大会を自動取得しています。'
  };
}

// ========================================
// キャッシュ
// ========================================
const getCachedSeriesData = unstable_cache(
  async () => {
    console.log('人形劇データをSmashmateから取得');
    return buildSeriesData();
  },
  ['ningyogeki-series-data'],
  {
    revalidate: 3600
  }
);

// ========================================
// API
// ========================================
export async function GET(request) {

  try {

    const { searchParams } =
      new URL(request.url);

    const refresh =
      searchParams.get('refresh') === '1';

    // 通常アクセス
    // → キャッシュを使用
    if (!refresh) {

      const data =
        await getCachedSeriesData();

      return Response.json(data);
    }

    // 「最新データを取得」
    // → キャッシュを使わず最新取得
    const freshData =
      await buildSeriesData();

    return Response.json(freshData);

  } catch (error) {

    console.error(
      '人形劇シリーズ取得エラー',
      error
    );

    return Response.json(
      {
        error:
          '人形劇シリーズの取得に失敗しました。',
        detail:
          error.message
      },
      {
        status: 502
      }
    );
  }
}
