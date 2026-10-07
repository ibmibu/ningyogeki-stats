import * as cheerio from 'cheerio';

const USER_TOURNAMENT_URL =
  'https://smashmate.net/user_add_tournament/?user=81727';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; NingyogekiStats/1.0)',
};

function isBracketUrl(value) {
  try {
    const u = new URL(value);

    return (
      u.hostname === 'smashmate.net' &&
      /^\/bracket\/\d+\/?$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

function isUserTournamentUrl(value) {
  try {
    const u = new URL(value);

    return (
      u.hostname === 'smashmate.net' &&
      u.pathname === '/user_add_tournament/' &&
      u.searchParams.get('user') === '81727'
    );
  } catch {
    return false;
  }
}

/**
 * 81727の参加大会一覧から
 * 「人形劇#数字」の大会だけを取得
 */
async function getNingyogekiTournaments() {
  const res = await fetch(USER_TOURNAMENT_URL, {
    headers: HEADERS,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(
      `参加大会一覧を取得できませんでした（${res.status}）`
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const tournaments = new Map();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');

    if (!href) return;

    const name = $(el)
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // 「人形劇#132」のような大会名だけを対象にする
    const match = name.match(/^人形劇#(\d+)$/);

    if (!match) return;

    let url;

    try {
      url = new URL(
        href,
        'https://smashmate.net'
      );
    } catch {
      return;
    }

    if (
      url.hostname !== 'smashmate.net' ||
      !/^\/bracket\/\d+\/?$/.test(url.pathname)
    ) {
      return;
    }

    const number = Number(match[1]);

    tournaments.set(url.toString(), {
      name,
      number,
      url: url.toString(),
    });
  });

  return [...tournaments.values()].sort(
    (a, b) => a.number - b.number
  );
}

/**
 * 1大会分の対戦結果を取得
 */
async function scrapeTournament(url) {
  const res = await fetch(url, {
    headers: HEADERS,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(
      `${url} の取得に失敗しました（${res.status}）`
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const tournamentName =
    $('title')
      .text()
      .replace(
        'のトーナメント表 スマメイト',
        ''
      )
      .trim() || '人形劇';

  const players = new Map();
  const records = [];

  $('[data-round] .tour_div_in').each(
    (_, group) => {
      const boxes = $(group)
        .find('.tour_user_box')
        .toArray();

      if (boxes.length !== 2) return;

      const ps = boxes.map((el) => ({
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
        !ps[0].id ||
        !ps[1].id ||
        !ps[0].result ||
        !ps[1].result
      ) {
        return;
      }

      ps.forEach((p) => {
        if (!p.id) return;

        players.set(p.id, {
          id: p.id,
          name: p.name,
        });
      });

      const winner = ps.find(
        (p) => p.result === 1
      );

      const loser = ps.find(
        (p) => p.result === 2
      );

      if (
        !winner ||
        !loser ||
        !winner.id ||
        !loser.id
      ) {
        return;
      }

      const round = $(group)
        .closest('[data-round]')
        .attr('data-round');

      records.push({
        winner: winner.name,
        loser: loser.name,
        winnerId: winner.id,
        loserId: loser.id,
        round,
        tournamentName,
        tournamentUrl: url,
      });
    }
  );

  return {
    tournamentName,
    tournamentUrl: url,
    players: [...players.values()],
    records,
    matches: records.length,
  };
}

/**
 * 全大会の直接対戦成績を計算
 */
function calculateStats(records) {
  const stats = {};

  for (const r of records) {
    stats[r.winnerId] ??= {};
    stats[r.loserId] ??= {};

    stats[r.winnerId][r.loserId] ??= {
      wins: 0,
      losses: 0,
      rate: 0,
    };

    stats[r.loserId][r.winnerId] ??= {
      wins: 0,
      losses: 0,
      rate: 0,
    };

    stats[r.winnerId][r.loserId].wins++;

    stats[r.loserId][r.winnerId].losses++;
  }

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

  return stats;
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { url } = body;

    /*
     * --------------------------------------------------
     * 人形劇全大会モード
     * --------------------------------------------------
     */
    if (url && isUserTournamentUrl(url)) {
      const tournaments =
        await getNingyogekiTournaments();

      if (tournaments.length === 0) {
        return Response.json(
          {
            error:
              '人形劇の大会を1件も見つけられませんでした。',
          },
          { status: 404 }
        );
      }

      const allRecords = [];
      const allPlayers = new Map();
      const tournamentResults = [];

      for (const tournament of tournaments) {
        try {
          console.log(
            `人形劇#${tournament.number} を取得中...`
          );

          const result =
            await scrapeTournament(
              tournament.url
            );

          allRecords.push(
            ...result.records
          );

          for (const player of result.players) {
            allPlayers.set(
              player.id,
              player
            );
          }

          tournamentResults.push({
            name: tournament.name,
            number: tournament.number,
            url: tournament.url,
            matches: result.matches,
          });
        } catch (e) {
          console.error(
            `大会取得失敗: ${tournament.name}`,
            e
          );

          tournamentResults.push({
            name: tournament.name,
            number: tournament.number,
            url: tournament.url,
            matches: 0,
            error:
              e instanceof Error
                ? e.message
                : '取得失敗',
          });
        }
      }

      const stats =
        calculateStats(allRecords);

      return Response.json({
        tournamentName:
          '人形劇 全大会',

        tournaments:
          tournamentResults,

        tournamentCount:
          tournaments.length,

        players:
          [...allPlayers.values()],

        records:
          allRecords,

        matches:
          allRecords.length,

        stats,
      });
    }

    /*
     * --------------------------------------------------
     * 従来の1大会モード
     * --------------------------------------------------
     */
    if (url && isBracketUrl(url)) {
      const result =
        await scrapeTournament(url);

      const stats =
        calculateStats(
          result.records
        );

      return Response.json({
        ...result,
        stats,
      });
    }

    return Response.json(
      {
        error:
          'Smashmateの /bracket/番号/ URL、または人形劇の参加大会一覧URLを入力してください。',
      },
      { status: 400 }
    );
  } catch (e) {
    console.error(e);

    return Response.json(
      {
        error:
          '解析中にエラーが発生しました。',

        detail:
          e instanceof Error
            ? e.message
            : String(e),
      },
      { status: 500 }
    );
  }
}
