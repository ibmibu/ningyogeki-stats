import * as cheerio from 'cheerio';

const USER_TOURNAMENT_URL =
  'https://smashmate.net/user_add_tournament/?user=81727';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; NingyogekiStats/1.0)',
};

function isBracketUrl(value: string) {
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

function isUserTournamentUrl(value: string) {
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
 * 81727 の参加大会一覧から
 * 「人形劇#数字」の大会だけを取得する
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

  const tournaments = new Map<
    string,
    {
      name: string;
      number: number;
      url: string;
    }
  >();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const name = $(el).text().replace(/\s+/g, ' ').trim();

    // 「人形劇#132」のような大会名だけを対象にする
    const match = name.match(/^人形劇#(\d+)$/);
    if (!match) return;

    let url: URL;

    try {
      url = new URL(href, 'https://smashmate.net');
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
async function scrapeTournament(url: string) {
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
      .replace('のトーナメント表 スマメイト', '')
      .trim() || '人形劇';

  const players = new Map<
    string,
    {
      id: string;
      name: string;
    }
  >();

  const records: {
    winner: string;
    loser: string;
    winnerId: string;
    loserId: string;
    round: string | undefined;
    tournamentName: string;
    tournamentUrl: string;
  }[] = [];

  $('[data-round] .tour_div_in').each((_, group) => {
    const boxes = $(group).find('.tour_user_box').toArray();

    if (boxes.length !== 2) return;

    const ps = boxes.map((el) => ({
      id: $(el).attr('data-uid'),
      name: $(el).find('.tour_user_name').text().trim(),
      result: Number($(el).attr('data-result')),
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

    const winner = ps.find((p) => p.result === 1);
    const loser = ps.find((p) => p.result === 2);

    if (!winner || !loser || !winner.id || !loser.id) return;

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
  });

  return {
    tournamentName,
    tournamentUrl: url,
    players: [...players.values()],
    records,
    matches: records.length,
  };
}

/**
 * 全大会の対戦結果から直接対戦成績を作る
 */
function calculateStats(records: {
  winnerId: string;
  loserId: string;
}[]) {
  const stats: Record<
    string,
    Record<
      string,
      {
        wins: number;
        losses: number;
        rate: number;
      }
    >
  > = {};

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
      const total = s.wins + s.losses;

      s.rate =
        total > 0
          ? Math.round((s.wins / total) * 1000) / 10
          : 0;
    }
  }

  return stats;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { url } = body;

    /*
     * ---------------------------------------------------------
     * パターン1:
     * 81727の参加大会一覧URLが渡された場合
     *
     * → 人形劇#1 ～ 最新の人形劇を全部取得
     * ---------------------------------------------------------
     */
    if (url && isUserTournamentUrl(url)) {
      const tournaments = await getNingyogekiTournaments();

      if (tournaments.length === 0) {
        return Response.json(
          {
            error:
              '人形劇の大会を1件も見つけられませんでした。',
          },
          { status: 404 }
        );
      }

      const allRecords: any[] = [];
      const allPlayers = new Map<
        string,
        {
          id: string;
          name: string;
        }
      >();

      const tournamentResults = [];

      /*
       * 大会を1つずつ取得
       *
       * 同時に大量アクセスするとSmashmate側に
       * 負荷をかける可能性があるので順番に取得する
       */
      for (const tournament of tournaments) {
        try {
          const result = await scrapeTournament(
            tournament.url
          );

          allRecords.push(...result.records);

          for (const player of result.players) {
            allPlayers.set(player.id, player);
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

          /*
           * 1大会取得失敗しても、
           * 他の大会は引き続き集計する
           */
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

      const stats = calculateStats(allRecords);

      return Response.json({
        tournamentName: '人形劇 全大会',
        tournaments: tournamentResults,
        tournamentCount: tournaments.length,
        players: [...allPlayers.values()],
        records: allRecords,
        matches: allRecords.length,
        stats,
      });
    }

    /*
     * ---------------------------------------------------------
     * パターン2:
     * 今まで通り、単一の /bracket/ URL が渡された場合
     *
     * → 既存機能も残す
     * ---------------------------------------------------------
     */
    if (url && isBracketUrl(url)) {
      const result = await scrapeTournament(url);

      const stats = calculateStats(result.records);

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
        error: '解析中にエラーが発生しました。',
        detail:
          e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
