import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const UA =
  'Mozilla/5.0 (compatible; NingyogekiStats/1.0)';

const USER_ID = 81727;

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

async function getNingyogekiTournaments() {
  const url =
    `${BASE}/user_add_tournament/?user=${USER_ID}`;

  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const tournaments = new Map();

  $('a[href]').each((_, element) => {
    const a = $(element);

    const text = a
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const href = a.attr('href');

    if (!href) return;

    const match = text.match(
      /人形劇#(\d+)/
    );

    if (!match) return;

    const number = Number(match[1]);

    const tournamentMatch = href.match(
      /\/tournament\/(\d+)\/?/
    );

    if (!tournamentMatch) return;

    const tournamentId =
      Number(tournamentMatch[1]);

    tournaments.set(number, {
      number,
      tournamentId,
      name: `人形劇#${number}`,
      url:
        new URL(href, BASE).toString(),
    });
  });

  return [...tournaments.values()]
    .sort(
      (a, b) => b.number - a.number
    );
}

async function getBracketUrl(tournament) {
  const html =
    await fetchHtml(tournament.url);

  const $ = cheerio.load(html);

  let bracketUrl = null;

  $('a[href]').each((_, element) => {
    if (bracketUrl) return;

    const href =
      $(element).attr('href');

    if (!href) return;

    if (
      href.includes('/bracket/')
    ) {
      bracketUrl =
        new URL(href, BASE).toString();
    }
  });

  return {
    ...tournament,
    bracketUrl,
  };
}

export async function GET() {
  try {
    // ① 人形劇を全部発見
    const discovered =
      await getNingyogekiTournaments();

    // ② 各大会のトーナメント表URLを取得
    const tournaments = [];

    for (const tournament of discovered) {
      try {
        const result =
          await getBracketUrl(tournament);

        tournaments.push(result);
      } catch (error) {
        console.error(
          `取得失敗: 人形劇#${tournament.number}`,
          error
        );

        tournaments.push({
          ...tournament,
          bracketUrl: null,
          error: String(error),
        });
      }
    }

    return Response.json({
      seriesName: '人形劇',

      count: tournaments.length,

      min:
        tournaments.length > 0
          ? Math.min(
              ...tournaments.map(
                x => x.number
              )
            )
          : null,

      max:
        tournaments.length > 0
          ? Math.max(
              ...tournaments.map(
                x => x.number
              )
            )
          : null,

      tournaments,
    });

  } catch (error) {
    console.error(error);

    return Response.json(
      {
        error:
          '人形劇大会一覧の取得に失敗しました。',
        detail: String(error),
      },
      {
        status: 500,
      }
    );
  }
}
