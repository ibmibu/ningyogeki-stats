import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const UA =
  'Mozilla/5.0 (compatible; NingyogekiStats/1.0)';

const USER_TOURNAMENT_URL =
  `${BASE}/user_add_tournament/?user=81727`;

async function html(url) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
    },
    cache: 'no-store',
  });

  if (!r.ok) {
    throw Error(`${r.status} ${url}`);
  }

  return r.text();
}

/**
 * 81727の参加大会一覧から
 * 「人形劇#数字」の大会を全部探す
 */
async function discover() {
  const $ = cheerio.load(
    await html(USER_TOURNAMENT_URL)
  );

  const map = new Map();

  $('a[href]').each((_, e) => {
    const href = $(e).attr('href');
    if (!href) return;

    const text = $(e)
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const match = text.match(/^人形劇#(\d+)$/);

    if (!match) return;

    const number = Number(match[1]);

    const url = new URL(
      href,
      BASE
    );

    if (
      url.hostname !== 'smashmate.net' ||
      !/^\/tournament\/\d+\/?$/.test(
        url.pathname
      )
    ) {
      return;
    }

    map.set(number, {
      number,
      tournamentUrl: url.toString(),
    });
  });

  return [...map.values()].sort(
    (a, b) => a.number - b.number
  );
}

/**
 * 大会ページからトーナメント表URLを取得
 */
async function resolve(tournament) {
  const $ = cheerio.load(
    await html(tournament.tournamentUrl)
  );

  let bracketUrl = null;

  $('a[href*="/bracket/"]').each((_, e) => {
    const href = $(e).attr('href');

    if (!bracketUrl && href) {
      const url = new URL(href, BASE);

      if (
        url.hostname === 'smashmate.net' &&
        /^\/bracket\/\d+\/?$/.test(
          url.pathname
        )
      ) {
        bracketUrl = url.toString();
      }
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
 * トーナメント表から対戦結果を取得
 */
function parseBracket(htmlText, fallback) {
  const $ = cheerio.load(htmlText);

  const players = new Map();
  const records = [];

  const name =
    $('title')
      .text()
      .replace(
        'のトーナメント表 スマメイト',
        ''
      )
      .trim() || fallback;

  $('[data-round] .tour_div_in').each(
    (_, group) => {
      const boxes = $(group)
        .find('.tour_user_box')
        .toArray();

      if (boxes.length !== 2) return;

      const p = boxes.map((el) => ({
        id: $(el).attr('data-uid'),
        name: $(el)
          .find('.tour_user_name')
          .text()
          .trim(),
        result: Number(
          $(el).attr('data-result')
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

      p.forEach((player) => {
        players.set(player.id, {
          id: player.id,
          name: player.name,
        });
      });

      const winner = p.find(
        (x) => x.result === 1
      );

      const loser = p.find(
        (x) => x.result === 2
      );

      if (!winner || !loser) return;

      records.push({
        winner: winner.name,
        loser: loser.name,
        winnerId: winner.id,
        loserId: loser.id,
        round:
          $(group)
            .closest('[data-round]')
            .attr('data-round') || '',
      });
    }
  );

  return {
    tournamentName: name,
    players: [...players.values()],
    records,
  };
}

/**
 * 対戦成績を加算
 */
function add(stats, records) {
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
function finish(stats) {
  for (const a of Object.keys(stats)) {
    for (const b of Object.keys(stats[a])) {
      const s = stats[a][b];

      const total =
        s.wins + s.losses;

      s.rate =
        total > 0
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
     * ① 81727の参加大会一覧から
     *    人形劇#1～最新回を取得
     */
    const found = await discover();

    /*
     * ② 各大会ページから
     *    トーナメント表URLを取得
     */
    const resolved = [];

    for (let i = 0; i < found.length; i += 3) {
      const batch = found.slice(i, i + 3);

      const results = await Promise.all(
        batch.map(resolve)
      );

      resolved.push(
        ...results.filter(Boolean)
      );
    }

    /*
     * ③ 全人形劇の対戦結果を集計
     */
    const allPlayers = new Map();
    const stats = {};
    const records = [];
    const tournaments = [];

    for (const tournament of resolved) {
      try {
        const bracketHtml =
          await html(tournament.bracketUrl);

        const parsed = parseBracket(
          bracketHtml,
          `人形劇#${tournament.number}`
        );

        /*
         * 対戦がない大会は除外
         */
        if (!parsed.records.length) {
          continue;
        }

        /*
         * プレイヤーを統合
         */
        parsed.players.forEach(
          (player) => {
            allPlayers.set(
              player.id,
              player
            );
          }
        );

        /*
         * 勝敗を統合
         */
        add(stats, parsed.records);

        /*
         * 全試合を保存
         */
        parsed.records.forEach(
          (record) => {
            records.push({
              ...record,
              tournamentNumber:
                tournament.number,
              tournament:
                parsed.tournamentName,
            });
          }
        );

        tournaments.push({
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
      } catch (e) {
        console.error(
          `人形劇#${tournament.number} の取得失敗`,
          e
        );
      }
    }

    /*
     * ④ 勝率を計算
     */
    finish(stats);

    /*
     * ⑤ 最新・最古の大会番号
     */
    const numbers = tournaments.map(
      (x) => x.number
    );

    const latest =
      numbers.length > 0
        ? Math.max(...numbers)
        : null;

    const oldest =
      numbers.length > 0
        ? Math.min(...numbers)
        : null;

    return Response.json({
      seriesName: '人形劇',

      /*
       * ここが今回の重要ポイント
       */
      source:
        USER_TOURNAMENT_URL,

      count:
        tournaments.length,

      latest,
      oldest,

      tournaments,

      players:
        [...allPlayers.values()],

      records,

      matches:
        records.length,

      stats,

      discoveredOnListing:
        found.length,
    });
  } catch (e) {
    console.error(e);

    return Response.json(
      {
        error:
          '人形劇シリーズの取得に失敗しました。',
        detail:
          e instanceof Error
            ? e.message
            : String(e),
      },
      {
        status: 502,
      }
    );
  }
}

