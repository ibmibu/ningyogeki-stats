import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const UA = 'Mozilla/5.0 (compatible; NingyogekiStats/1.0)';

const USER_TOURNAMENT_URL =
  'https://smashmate.net/user_add_tournament/?user=81727';

async function html(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
    },
    cache: 'no-store',
  });

  if (!r.ok) {
    throw new Error(`${r.status} ${url}`);
  }

  return r.text();
}

/**
 * いぶさんの参加大会一覧から
 * 「人形劇#数字」の大会をすべて取得する
 */
async function discover() {
  const h = await html(USER_TOURNAMENT_URL);
  const $ = cheerio.load(h);

  const tournaments = [];

  $('a[href^="/tournament/"]').each((_, e) => {
    const href = $(e).attr('href');
    const text = $(e)
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    if (!href) return;

    const tournamentMatch = href.match(
      /^\/tournament\/(\d+)\/?$/
    );

    const numberMatch = text.match(
      /人形劇#(\d+)/
    );

    if (!tournamentMatch || !numberMatch) {
      return;
    }

    tournaments.push({
      number: Number(numberMatch[1]),
      tournamentId: Number(tournamentMatch[1]),
      tournamentUrl: new URL(href, BASE).toString(),
    });
  });

  // 同じ大会が複数回出てきても重複しないようにする
  const map = new Map();

  for (const tournament of tournaments) {
    map.set(tournament.number, tournament);
  }

  return [...map.values()].sort(
    (a, b) => a.number - b.number
  );
}

/**
 * 大会ページからトーナメント表URLを取得する
 */
async function resolveBracket(tournament) {
  const h = await html(tournament.tournamentUrl);
  const $ = cheerio.load(h);

  let bracketUrl = null;

  $('a[href*="/bracket/"]').each((_, e) => {
    if (bracketUrl) return;

    const href = $(e).attr('href');

    if (href) {
      bracketUrl = new URL(href, BASE).toString();
    }
  });

  if (!bracketUrl) {
    return null;
  }

  return {
    ...tournament,
    bracketUrl,
  };
}

/**
 * トーナメント表から選手と対戦結果を取得
 */
function parseBracket(h, fallbackName) {
  const $ = cheerio.load(h);

  const players = new Map();
  const records = [];

  const tournamentName =
    $('title')
      .text()
      .replace('のトーナメント表 スマメイト', '')
      .trim() || fallbackName;

  $('[data-round] .tour_div_in').each((_, g) => {
    const boxes = $(g)
      .find('.tour_user_box')
      .toArray();

    if (boxes.length !== 2) {
      return;
    }

    const p = boxes.map((e) => ({
      id: $(e).attr('data-uid'),
      name: $(e)
        .find('.tour_user_name')
        .text()
        .trim(),
      result: Number(
        $(e).attr('data-result')
      ),
    }));

    if (
      !p[0].id ||
      !p[1].id ||
      !p[0].result ||
      !p[1].result
    ) {
      return;
    }

    p.forEach((x) => {
      players.set(x.id, {
        id: x.id,
        name: x.name,
      });
    });

    const winner = p.find(
      (x) => x.result === 1
    );

    const loser = p.find(
      (x) => x.result === 2
    );

    if (!winner || !loser) {
      return;
    }

    records.push({
      winner: winner.name,
      loser: loser.name,
      winnerId: winner.id,
      loserId: loser.id,
      round:
        $(g)
          .closest('[data-round]')
          .attr('data-round') || '',
    });
  });

  return {
    tournamentName,
    players: [...players.values()],
    records,
  };
}

/**
 * 対戦成績を追加
 */
function addStats(stats, records) {
  for (const r of records) {
    stats[r.winnerId] ??= {};
    stats[r.loserId] ??= {};

    stats[r.winnerId][r.loserId] ??= {
      wins: 0,
      losses: 0,
    };

    stats[r.loserId][r.winnerId] ??= {
      wins: 0,
      losses: 0,
    };

    stats[r.winnerId][r.loserId].wins++;
    stats[r.loserId][r.winnerId].losses++;
  }
}

/**
 * 勝率を計算
 */
function finishStats(stats) {
  for (const a of Object.keys(stats)) {
    for (const b of Object.keys(stats[a])) {
      const s = stats[a][b];

      const total =
        s.wins + s.losses;

      s.rate = total
        ? Math.round(
            (s.wins / total) * 1000
          ) / 10
        : 0;
    }
  }
}

export async function GET() {
  try {
    /*
     * ① いぶさんの参加大会一覧から
     *    人形劇#1〜最新を全部発見
     */
    const discovered = await discover();

    /*
     * ② 各大会ページから
     *    トーナメント表URLを取得
     *
     * 一度に3件ずつ処理して
     * Smashmateへのアクセスを集中させない
     */
    const resolved = [];

    for (let i = 0; i < discovered.length; i += 3) {
      const batch = discovered.slice(i, i + 3);

      const results = await Promise.all(
        batch.map(resolveBracket)
      );

      resolved.push(
        ...results.filter(Boolean)
      );
    }

    /*
     * ③ 大会番号順に並べる
     */
    const tournaments = resolved.sort(
      (a, b) => a.number - b.number
    );

    const allPlayers = new Map();
    const stats = {};
    const records = [];
    const done = [];

    /*
     * ④ 各大会のトーナメント表を解析
     */
    for (const tournament of tournaments) {
      try {
        const bracketHtml = await html(
          tournament.bracketUrl
        );

        const parsed = parseBracket(
          bracketHtml,
          `人形劇#${tournament.number}`
        );

        if (!parsed.records.length) {
          continue;
        }

        /*
         * プレイヤー登録
         */
        for (const player of parsed.players) {
          allPlayers.set(
            player.id,
            player
          );
        }

        /*
         * 直接対戦成績に追加
         */
        addStats(
          stats,
          parsed.records
        );

        /*
         * 大会番号を付けて全試合を保存
         */
        for (const record of parsed.records) {
          records.push({
            ...record,
            tournamentNumber:
              tournament.number,
            tournament:
              parsed.tournamentName,
          });
        }

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
            parsed.players.length,
        });
      } catch (error) {
        console.error(
          `人形劇#${tournament.number} の取得に失敗:`,
          error
        );
      }
    }

    /*
     * ⑤ 勝率計算
     */
    finishStats(stats);

    /*
     * ⑥ 結果を返す
     */
    return Response.json({
      seriesName: '人形劇',

      tournaments: done,

      players: [
        ...allPlayers.values(),
      ],

      records,

      matches: records.length,

      stats,

      /*
       * デバッグ用
       */
      discoveredOnUserPage:
        discovered.length,

      loadedTournaments:
        done.length,

      firstTournament:
        done.length
          ? done[0].number
          : null,

      lastTournament:
        done.length
          ? done[done.length - 1].number
          : null,
    });
  } catch (e) {
    console.error(e);

    return Response.json(
      {
        error:
          '人形劇シリーズの取得に失敗しました。',
        detail: e.message,
      },
      {
        status: 502,
      }
    );
  }
}
