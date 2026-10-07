import * as cheerio from 'cheerio';

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


// ==============================
// 大会一覧から「人形劇」を探す
// ==============================
async function discover() {
  const found = new Map();

  let page = 1;

  while (true) {
    const url =
      page === 1
        ? `${BASE}/user_add_tournament/?user=${USER_ID}`
        : `${BASE}/user_add_tournament/?user=${USER_ID}&page=${page}`;

    const $ = cheerio.load(await html(url));

    let foundOnPage = 0;

    $('a[href^="/tournament/"]').each((_, e) => {
      const href = $(e).attr('href');
      const text = $(e)
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      const m = href?.match(/^\/tournament\/(\d+)\/?$/);
      const n = text.match(/人形劇#(\d+)/);

      if (!m || !n) return;

      const number = Number(n[1]);

      if (!found.has(number)) {
        found.set(number, {
          number,
          tournamentUrl: BASE + href
        });

        foundOnPage++;
      }
    });

    // このページに人形劇が無ければ終了
    if (foundOnPage === 0) {
      break;
    }

    page++;

    // 念のため無限ループ防止
    if (page > 100) {
      break;
    }
  }

  return [...found.values()];
}


// ==============================
// 大会ページからbracket URLを探す
// ==============================
async function resolve(tournament) {
  const $ = cheerio.load(
    await html(tournament.tournamentUrl)
  );

  let bracketUrl = null;

  $('a[href*="/bracket/"]').each((_, e) => {
    const href = $(e).attr('href');

    if (!bracketUrl && href) {
      bracketUrl = new URL(href, BASE).toString();
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


// ==============================
// トーナメント表を解析
// ==============================
function parseBracket(h, fallback) {
  const $ = cheerio.load(h);

  const players = new Map();
  const records = [];

  const tournamentName =
    $('title')
      .text()
      .replace('のトーナメント表 スマメイト', '')
      .trim() ||
    fallback;

  $('[data-round] .tour_div_in').each((_, g) => {
    const boxes = $(g)
      .find('.tour_user_box')
      .toArray();

    if (boxes.length !== 2) return;

    const p = boxes.map(e => ({
      id: $(e).attr('data-uid'),
      name: $(e)
        .find('.tour_user_name')
        .text()
        .trim(),
      result: Number(
        $(e).attr('data-result')
      )
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

    const winner = p.find(
      x => x.result === 1
    );

    const loser = p.find(
      x => x.result === 2
    );

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
    tournamentName,
    players: [...players.values()],
    records
  };
}


// ==============================
// 対戦成績を追加
// ==============================
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


// ==============================
// 勝率計算
// ==============================
function finish(stats) {
  for (const a of Object.keys(stats)) {
    for (const b of Object.keys(stats[a])) {
      const s = stats[a][b];

      const total =
        s.wins + s.losses;

      s.rate =
        total
          ? Math.round(
              (s.wins / total) * 1000
            ) / 10
          : 0;
    }
  }
}


// ==============================
// API
// ==============================
export async function GET() {
  try {

    // --------------------------
    // ① ユーザーの大会一覧を取得
    // --------------------------
    const discovered = await discover();


    // --------------------------
    // ② 人形劇だけ取得
    // --------------------------
    discovered.sort(
      (a, b) => a.number - b.number
    );


    // --------------------------
    // ③ 各大会のbracketを取得
    // --------------------------
    const tournaments = [];

    for (const tournament of discovered) {
      try {

        const resolved =
          await resolve(tournament);

        if (resolved) {
          tournaments.push(resolved);
        }

      } catch (e) {
        console.error(
          '大会取得失敗:',
          tournament.number,
          e
        );
      }
    }


    // --------------------------
    // ④ 全大会を集計
    // --------------------------
    const allPlayers = new Map();
    const stats = {};
    const records = [];
    const done = [];

    for (const tournament of tournaments) {

      try {

        const parsed =
          parseBracket(
            await html(tournament.bracketUrl),
            `人形劇#${tournament.number}`
          );

        if (!parsed.records.length) {
          continue;
        }

        // プレイヤー登録
        parsed.players.forEach(player => {
          allPlayers.set(
            player.id,
            player
          );
        });

        // 対戦成績追加
        add(
          stats,
          parsed.records
        );

        // 個別試合
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

      } catch (e) {

        console.error(
          'bracket解析失敗:',
          tournament.number,
          e
        );

      }
    }


    // --------------------------
    // ⑤ 勝率計算
    // --------------------------
    finish(stats);


    // --------------------------
    // ⑥ JSON返却
    // --------------------------
    return Response.json({

      seriesName: '人形劇',

      userId: USER_ID,

      tournaments: done,

      players:
        [...allPlayers.values()],

      records,

      matches:
        records.length,

      stats,

      discoveredOnListing:
        discovered.length,

      minTournament:
        discovered.length
          ? Math.min(
              ...discovered.map(
                x => x.number
              )
            )
          : null,

      maxTournament:
        discovered.length
          ? Math.max(
              ...discovered.map(
                x => x.number
              )
            )
          : null
    });

  } catch (e) {

    return Response.json(
      {
        error:
          '人形劇シリーズの取得に失敗しました。',
        detail:
          e.message
      },
      {
        status: 502
      }
    );
  }
}
