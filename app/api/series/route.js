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
    throw new Error(
      `HTTP ${r.status}: ${url}`
    );
  }

  return await r.text();
}

/*
 * =========================================================
 * 人形劇の大会を全部探す
 * =========================================================
 *
 * /tournament/ の一覧は使わない。
 *
 * いぶさんの参加大会一覧から
 *
 * 人形劇#132
 * 人形劇#131
 * ...
 * 人形劇#1
 *
 * を直接拾う。
 */
async function discover() {
  const source = await html(
    USER_TOURNAMENT_URL
  );

  const $ = cheerio.load(source);

  const tournaments = new Map();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');

    if (!href) return;

    const text = $(el)
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const nameMatch =
      text.match(/人形劇#(\d+)/);

    if (!nameMatch) return;

    const idMatch =
      href.match(
        /^\/tournament\/(\d+)\/?$/
      );

    if (!idMatch) return;

    const number =
      Number(nameMatch[1]);

    const tournamentId =
      Number(idMatch[1]);

    tournaments.set(number, {
      number,
      tournamentId,
      name: `人形劇#${number}`,
      tournamentUrl:
        new URL(
          href,
          BASE
        ).toString(),
    });
  });

  return [...tournaments.values()]
    .sort(
      (a, b) =>
        a.number - b.number
    );
}

/*
 * =========================================================
 * 大会ページからbracket URLを探す
 * =========================================================
 */
async function resolve(tournament) {
  const source =
    await html(
      tournament.tournamentUrl
    );

  const $ = cheerio.load(source);

  let bracketUrl = null;

  $('a[href]').each((_, el) => {
    if (bracketUrl) return;

    const href =
      $(el).attr('href');

    if (
      href &&
      href.includes('/bracket/')
    ) {
      bracketUrl =
        new URL(
          href,
          BASE
        ).toString();
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

/*
 * =========================================================
 * bracket解析
 * =========================================================
 *
 * 現在のSmashmate用。
 *
 * まず既存形式を解析し、
 * 取得できなかった場合でも大会自体は
 * 一覧に残す。
 */
function parseBracket(
  source,
  fallbackName
) {
  const $ =
    cheerio.load(source);

  const players =
    new Map();

  const records = [];

  const title =
    $('title')
      .text()
      .replace(
        'のトーナメント表 スマメイト',
        ''
      )
      .trim();

  const tournamentName =
    title || fallbackName;

  /*
   * 既存のHTML形式
   */
  $('[data-round] .tour_div_in')
    .each((_, game) => {
      const boxes =
        $(game)
          .find('.tour_user_box')
          .toArray();

      if (boxes.length !== 2) {
        return;
      }

      const pair =
        boxes.map((box) => ({
          id:
            $(box).attr(
              'data-uid'
            ),

          name:
            $(box)
              .find('.tour_user_name')
              .text()
              .trim(),

          result:
            Number(
              $(box).attr(
                'data-result'
              )
            ),
        }));

      if (
        !pair[0].id ||
        !pair[1].id ||
        !pair[0].name ||
        !pair[1].name
      ) {
        return;
      }

      pair.forEach((player) => {
        players.set(
          player.id,
          {
            id: player.id,
            name: player.name,
          }
        );
      });

      const winner =
        pair.find(
          (x) => x.result === 1
        );

      const loser =
        pair.find(
          (x) => x.result === 2
        );

      if (!winner || !loser) {
        return;
      }

      records.push({
        winner: winner.name,
        loser: loser.name,

        winnerId:
          winner.id,

        loserId:
          loser.id,

        round:
          $(game)
            .closest('[data-round]')
            .attr(
              'data-round'
            ) || '',
      });
    });

  return {
    tournamentName,
    players: [
      ...players.values()
    ],
    records,
  };
}

/*
 * =========================================================
 * statsに対戦結果を追加
 * =========================================================
 */
function addStats(
  stats,
  records
) {
  for (const record of records) {
    const winner =
      record.winnerId;

    const loser =
      record.loserId;

    stats[winner] ??= {};
    stats[loser] ??= {};

    stats[winner][loser] ??= {
      wins: 0,
      losses: 0,
    };

    stats[loser][winner] ??= {
      wins: 0,
      losses: 0,
    };

    stats[winner][loser]
      .wins++;

    stats[loser][winner]
      .losses++;
  }
}

/*
 * =========================================================
 * 勝率
 * =========================================================
 */
function finishStats(stats) {
  for (
    const playerId
    of Object.keys(stats)
  ) {
    for (
      const opponentId
      of Object.keys(
        stats[playerId]
      )
    ) {
      const record =
        stats[playerId][
          opponentId
        ];

      const total =
        record.wins +
        record.losses;

      record.rate =
        total > 0
          ? Math.round(
              record.wins /
                total *
                1000
            ) / 10
          : 0;
    }
  }
}

/*
 * =========================================================
 * GET
 * =========================================================
 */
export async function GET() {
  try {
    /*
     * -----------------------------------------------------
     * ① 人形劇を全部取得
     * -----------------------------------------------------
     */
    const discovered =
      await discover();

    /*
     * -----------------------------------------------------
     * ② 各大会のbracket URLを取得
     * -----------------------------------------------------
     */
    const resolved = [];

    /*
     * Smashmateへのアクセスを
     * 3大会ずつに制限
     */
    for (
      let i = 0;
      i < discovered.length;
      i += 3
    ) {
      const batch =
        discovered.slice(
          i,
          i + 3
        );

      const result =
        await Promise.all(
          batch.map(
            async (tournament) => {
              try {
                return await resolve(
                  tournament
                );
              } catch (error) {
                console.error(
                  `大会取得失敗: ${tournament.name}`,
                  error
                );

                return {
                  ...tournament,
                  bracketUrl: null,
                };
              }
            }
          )
        );

      resolved.push(
        ...result.filter(Boolean)
      );
    }

    /*
     * -----------------------------------------------------
     * ③ 大会番号順
     * -----------------------------------------------------
     */
    const tournaments =
      resolved.sort(
        (a, b) =>
          a.number - b.number
      );

    /*
     * -----------------------------------------------------
     * ④ 全大会の対戦結果
     * -----------------------------------------------------
     */
    const allPlayers =
      new Map();

    const stats = {};

    const records = [];

    const done = [];

    /*
     * 1大会ずつ処理
     */
    for (
      const tournament
      of tournaments
    ) {
      /*
       * bracketが存在しない大会も
       * 一覧には残す
       */
      if (
        !tournament.bracketUrl
      ) {
        done.push({
          number:
            tournament.number,

          name:
            tournament.name,

          tournamentUrl:
            tournament.tournamentUrl,

          bracketUrl:
            null,

          matches: 0,

          players: 0,

          error:
            'bracket URLを取得できませんでした',
        });

        continue;
      }

      try {
        const bracketHtml =
          await html(
            tournament.bracketUrl
          );

        const parsed =
          parseBracket(
            bracketHtml,
            tournament.name
          );

        /*
         * プレイヤー
         */
        for (
          const player
          of parsed.players
        ) {
          allPlayers.set(
            player.id,
            player
          );
        }

        /*
         * 対戦結果
         */
        addStats(
          stats,
          parsed.records
        );

        /*
         * 全対戦履歴
         */
        for (
          const record
          of parsed.records
        ) {
          records.push({
            ...record,

            tournamentNumber:
              tournament.number,

            tournament:
              parsed.tournamentName,
          });
        }

        done.push({
          number:
            tournament.number,

          name:
            parsed.tournamentName,

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
          `bracket解析失敗: ${tournament.name}`,
          error
        );

        /*
         * 解析に失敗しても
         * 大会一覧から消さない
         */
        done.push({
          number:
            tournament.number,

          name:
            tournament.name,

          tournamentUrl:
            tournament.tournamentUrl,

          bracketUrl:
            tournament.bracketUrl,

          matches: 0,

          players: 0,

          error:
            String(error),
        });
      }
    }

    /*
     * -----------------------------------------------------
     * ⑤ 勝率計算
     * -----------------------------------------------------
     */
    finishStats(stats);

    /*
     * -----------------------------------------------------
     * ⑥ page.jsに返す
     * -----------------------------------------------------
     */
    return Response.json({
      seriesName:
        '人形劇',

      tournaments:
        done,

      players:
        [
          ...allPlayers.values()
        ],

      records,

      matches:
        records.length,

      stats,

      /*
       * デバッグ用
       */
      discoveredOnListing:
        discovered.length,

      resolvedTournaments:
        resolved.length,

      loadedTournaments:
        done.length,

      latest:
        discovered.length
          ? discovered[
              discovered.length - 1
            ].number
          : null,

      oldest:
        discovered.length
          ? discovered[0].number
          : null,
    });

  } catch (error) {
    console.error(
      '人形劇取得エラー',
      error
    );

    return Response.json(
      {
        error:
          '人形劇シリーズの取得に失敗しました。',

        detail:
          error.message,
      },
      {
        status: 502,
      }
    );
  }
}
