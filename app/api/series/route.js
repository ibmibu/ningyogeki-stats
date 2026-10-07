import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const USER_TOURNAMENT_URL =
  'https://smashmate.net/user_add_tournament/?user=81727';

const UA =
  'Mozilla/5.0 (compatible; NingyogekiStats/1.0)';

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    );
  }

  return await response.text();
}

/**
 * いぶさんの参加大会一覧から
 * 人形劇#1〜最新を全部取得
 */
async function discoverTournaments() {
  const html =
    await fetchHtml(USER_TOURNAMENT_URL);

  const $ = cheerio.load(html);

  const tournaments = new Map();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');

    if (!href) {
      return;
    }

    const text = $(element)
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // 「人形劇#132」など
    const nameMatch =
      text.match(/人形劇#(\d+)/);

    if (!nameMatch) {
      return;
    }

    // /tournament/33755/
    const idMatch =
      href.match(
        /\/tournament\/(\d+)\/?$/
      );

    if (!idMatch) {
      return;
    }

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
        b.number - a.number
    );
}

/**
 * 大会ページからトーナメント表URLを取得
 */
async function getBracketUrl(tournament) {
  const html =
    await fetchHtml(
      tournament.tournamentUrl
    );

  const $ = cheerio.load(html);

  let bracketUrl = null;

  $('a[href]').each((_, element) => {
    if (bracketUrl) {
      return;
    }

    const href =
      $(element).attr('href');

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

  return {
    ...tournament,
    bracketUrl,
  };
}

/**
 * GET /api/series
 */
export async function GET() {
  try {
    // ========================================
    // ① 人形劇を全部発見
    // ========================================

    const discovered =
      await discoverTournaments();

    // ========================================
    // ② 各大会のbracket URLを取得
    // ========================================

    const tournaments = [];

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

      const results =
        await Promise.all(
          batch.map(
            getBracketUrl
          )
        );

      tournaments.push(
        ...results
      );
    }

    // ========================================
    // ③ 大会番号順
    // ========================================

    tournaments.sort(
      (a, b) =>
        b.number - a.number
    );

    // ========================================
    // ④ 今回は大会一覧を返す
    // ========================================
    //
    // 対戦結果解析は一旦しない。
    // まず「全人形劇を取得できる」ことを
    // 確認する。
    //

    return Response.json({
      seriesName: '人形劇',

      count:
        tournaments.length,

      latest:
        tournaments.length
          ? tournaments[0].number
          : null,

      oldest:
        tournaments.length
          ? tournaments[
              tournaments.length - 1
            ].number
          : null,

      tournaments,
    });

  } catch (error) {
    console.error(
      '人形劇取得エラー:',
      error
    );

    return Response.json(
      {
        error:
          '人形劇の取得に失敗しました。',
        detail:
          String(error),
      },
      {
        status: 500,
      }
    );
  }
}
