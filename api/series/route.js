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
    const b = $(g).find('.tour_user_box').toArray();

    if (b.length !== 2) return;

    const p = b.map(e => ({
      id: $(e).attr('data-uid'),
      name: $(e).find('.tour_user_name').text().trim(),
      result: Number($(e).attr('data-result'))
    }));

    if (
      !p[0].id ||
      !p[1].id ||
      !p[0].result ||
      !p[1].result
    ) return;

    p.forEach(x =>
      players.set(x.id, {
        id: x.id,
        name: x.name
      })
    );

    const w = p.find(x => x.result === 1);
    const l = p.find(x => x.result === 2);

    if (!w || !l) return;

    records.push({
      winner: w.name,
      loser: l.name,
      winnerId: w.id,
      loserId: l.id,
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

function add(stats, rs) {
  for (const r of rs) {
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
      const t = s.wins + s.losses;

      s.rate = t
        ? Math.round((s.wins / t) * 1000) / 10
        : 0;
    }
  }
}


// ========================================
// ユーザーの大会一覧から人形劇を探す
// ========================================
async function discover() {
  const url =
    `${BASE}/user_add_tournament/?user=${USER_ID}`;

  const $ = cheerio.load(await html(url));
  const out = [];

  $('a[href*="/tournament/"]').each((_, e) => {
    const href = $(e).attr('href');
    const text = $(e)
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const m = text.match(/人形劇#(\d+)/);

    if (!m || !href) return;

    out.push({
      number: Number(m[1]),
      tournamentUrl: new URL(href, BASE).toString()
    });
  });

  // 重複を削除して大会番号順にする
  const unique = new Map();

  for (const x of out) {
    unique.set(x.number, x);
  }

  return [...unique.values()].sort(
    (a, b) => a.number - b.number
  );
}


// ========================================
// 大会ページからBracket URLを探す
// ========================================
async function resolve(x) {
  const $ = cheerio.load(
    await html(x.tournamentUrl)
  );

  let bracketUrl = null;

  $('a[href*="/bracket/"]').each((_, e) => {
    const href = $(e).attr('href');

    if (!bracketUrl && href) {
      bracketUrl =
        new URL(href, BASE).toString();
    }
  });

  if (!bracketUrl) {
    return null;
  }

  return {
    ...x,
    bracketUrl
  };
}


// ========================================
// API
// ========================================
export async function GET() {
  try {

    // ------------------------------------
    // ① ユーザーの参加大会から人形劇を取得
    // ------------------------------------
    const found = await discover();


    // ------------------------------------
    // ② 各大会のBracket URLを取得
    //    同時に3大会ずつ処理
    // ------------------------------------
    const resolved = [];

    for (let i = 0; i < found.length; i += 3) {
      const r = await Promise.all(
        found
          .slice(i, i + 3)
          .map(resolve)
      );

      resolved.push(
        ...r.filter(Boolean)
      );
    }

    const tournaments = resolved.sort(
      (a, b) => a.number - b.number
    );


    // ------------------------------------
    // ③ 全大会を集計
    // ------------------------------------
    const allPlayers = new Map();
    const stats = {};
    const records = [];
    const done = [];

    for (const t of tournaments) {

      try {

        const p = parseBracket(
          await html(t.bracketUrl),
          `人形劇#${t.number}`
        );

        if (!p.records.length) {
          continue;
        }


        // プレイヤー
        p.players.forEach(x => {
          allPlayers.set(x.id, x);
        });


        // 戦績
        add(stats, p.records);


        // 対戦記録
        p.records.forEach(r => {
          records.push({
            ...r,
            tournamentNumber: t.number,
            tournament: p.tournamentName
          });
        });


        // 完了した大会
        done.push({
          number: t.number,
          name: p.tournamentName,
          tournamentUrl: t.tournamentUrl,
          bracketUrl: t.bracketUrl,
          matches: p.records.length,
          players: p.players.length
        });

      } catch (e) {

        console.error(
          `人形劇#${t.number} の取得に失敗:`,
          e
        );

      }
    }


    // ------------------------------------
    // ④ 勝率を計算
    // ------------------------------------
    finish(stats);


    // ------------------------------------
    // ⑤ JSONを返す
    // ------------------------------------
    return Response.json({
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
        'user_add_tournamentから人形劇の大会を自動取得して集計しています。'
    });

  } catch (e) {

    return Response.json(
      {
        error:
          '人形劇シリーズの取得に失敗しました。',
        detail: e.message
      },
      {
        status: 502
      }
    );
  }
}
