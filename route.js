import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const USER_ID = 81727;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

const CONCURRENCY = 3;
const NAME_CONCURRENCY = 5;

const ACCOUNT_ALIASES = {
  '99450': '145071',
  '118591': '149650',
  '148400': '164481',
  '80108': '142959',
  '100389': '167992',
  '159344': '167992',
  '156108': '156414',
};

function canonicalId(id) {
  let current = String(id);
  const seen = new Set();

  while (ACCOUNT_ALIASES[current] && !seen.has(current)) {
    seen.add(current);
    current = String(ACCOUNT_ALIASES[current]);
  }

  return current;
}

async function html(url, referer = `${BASE}/`) {
  let lastError;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          Referer: referer,
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }

  throw new Error(`${lastError?.message || '取得失敗'}: ${url}`);
}

async function discoverFromUserPage() {
  const userUrl = `${BASE}/user_add_tournament/?user=${USER_ID}`;
  const $ = cheerio.load(await html(userUrl));
  const found = new Map();

  $('a[href*="/tournament/"]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const text = $(element).text().replace(/\s+/g, ' ').trim();
    const id = href.match(/\/tournament\/(\d+)\/?/)?.[1];
    const number = text.match(/人形劇\s*#\s*(\d+)/)?.[1];

    if (!id || !number) return;

    found.set(Number(number), {
      number: Number(number),
      tournamentId: id,
      tournamentUrl: `${BASE}/tournament/${id}/`,
    });
  });

  return [...found.values()].sort((a, b) => a.number - b.number);
}

async function findBracketUrl(tournament) {
  const page = await html(
    tournament.tournamentUrl,
    `${BASE}/user_add_tournament/?user=${USER_ID}`
  );

  const $ = cheerio.load(page);
  let href = '';

  $('a[href*="/bracket/"]').each((_, element) => {
    const candidate = $(element).attr('href') || '';
    if (!href && /\/bracket\/\d+\/?/.test(candidate)) {
      href = candidate;
    }
  });

  const id = href.match(/\/bracket\/(\d+)\/?/)?.[1];

  if (!id) {
    throw new Error('トーナメント表（bracket）のURLが見つかりません');
  }

  return `${BASE}/bracket/${id}/`;
}

function parseBracket(text, fallback) {
  const $ = cheerio.load(text);
  const players = new Map();
  const records = [];

  const title = $('title')
    .text()
    .replace(/のトーナメント表\s*スマメイト.*/u, '')
    .trim();

  const tournamentName = title || fallback;

  $('.tour_div_in').each((_, group) => {
    const boxes = $(group).find('.tour_user_box').toArray();
    if (boxes.length !== 2) return;

    const pair = boxes.map((element) => ({
      id: $(element).attr('data-uid'),
      name: $(element)
        .find('.tour_user_name')
        .text()
        .replace(/\s+/g, ' ')
        .trim(),
      result: Number($(element).attr('data-result')),
    }));

    if (
      pair.some(
        (player) =>
          !player.id ||
          !player.name ||
          ![1, 2].includes(player.result)
      )
    ) {
      return;
    }

    pair.forEach((player) => {
      const id = canonicalId(player.id);
      players.set(id, { id, name: player.name });
    });

    const winner = pair.find((player) => player.result === 1);
    const loser = pair.find((player) => player.result === 2);

    if (!winner || !loser) return;

    records.push({
      winner: winner.name,
      loser: loser.name,
      winnerId: canonicalId(winner.id),
      loserId: canonicalId(loser.id),
    });
  });

  return {
    tournamentName,
    players: [...players.values()],
    records,
  };
}

function addStats(stats, records) {
  for (const record of records) {
    stats[record.winnerId] ??= {};
    stats[record.loserId] ??= {};

    stats[record.winnerId][record.loserId] ??= {
      wins: 0,
      losses: 0,
    };

    stats[record.loserId][record.winnerId] ??= {
      wins: 0,
      losses: 0,
    };

    stats[record.winnerId][record.loserId].wins++;
    stats[record.loserId][record.winnerId].losses++;
  }
}

function finishStats(stats) {
  for (const opponents of Object.values(stats)) {
    for (const stat of Object.values(opponents)) {
      const total = stat.wins + stat.losses;
      stat.rate = total
        ? Math.round((stat.wins / total) * 1000) / 10
        : 0;
    }
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const output = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;

      try {
        output[index] = await fn(items[index], index);
      } catch (error) {
        output[index] = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      worker
    )
  );

  return output;
}

async function fetchCurrentPlayerName(player) {
  try {
    const page = await html(`${BASE}/user/${player.id}/`);
    const $ = cheerio.load(page);

    const heading = $('h1')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const match = heading.match(/^(.*?)さんのユーザーページ$/u);

    if (match?.[1]?.trim()) {
      return { id: player.id, name: match[1].trim() };
    }
  } catch (_) {}

  return player;
}

async function refreshCurrentPlayerNames(players) {
  const refreshed = await mapWithConcurrency(
    players,
    NAME_CONCURRENCY,
    fetchCurrentPlayerName
  );

  return refreshed.map((player, index) =>
    player?.error ? players[index] : player
  );
}

async function fetchTournament(tournament) {
  const bracketUrl = await findBracketUrl(tournament);
  const parsed = parseBracket(
    await html(bracketUrl, tournament.tournamentUrl),
    `人形劇#${tournament.number}`
  );

  return {
    ...tournament,
    bracketUrl,
    ...parsed,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);

    // ブラウザが既に保存している大会番号。
    // 大会一覧そのものは毎回1回だけ確認し、ここにない大会だけ取得する。
    const forceFull = searchParams.get('full') === '1';

    const known = new Set(
      forceFull
        ? []
        : (searchParams.get('known') || '')
            .split(',')
            .map((value) => Number(value))
            .filter(Number.isFinite)
    );

    const allTournaments = await discoverFromUserPage();

    const targets = allTournaments.filter(
      (tournament) => !known.has(tournament.number)
    );

    console.log(
      `人形劇: 大会一覧${allTournaments.length}件 / 未取得${targets.length}件`
    );

    // 未取得大会が1件もなければ、ここで終了。
    // tournament page / bracket / player page は一切読まない。
    if (targets.length === 0) {
      return Response.json({
        seriesName: '人形劇',
        source: `${BASE}/user_add_tournament/?user=${USER_ID}`,
        tournaments: [],
        players: [],
        records: [],
        matches: 0,
        stats: {},
        discoveredOnUserPage: allTournaments.length,
        failed: [],
        upToDate: true,
      });
    }

    const results = await mapWithConcurrency(
      targets,
      CONCURRENCY,
      fetchTournament
    );

    const players = new Map();
    const stats = {};
    const records = [];
    const tournaments = [];
    const failed = [];

    results.forEach((result, index) => {
      const source = targets[index];

      if (!result || result.error) {
        failed.push({
          number: source.number,
          tournamentUrl: source.tournamentUrl,
          error: result?.error || '大会データの取得に失敗しました',
        });
        return;
      }

      result.players.forEach((player) => {
        const id = canonicalId(player.id);
        players.set(id, { id, name: player.name });
      });

      addStats(stats, result.records);

      result.records.forEach((record) => {
        records.push({
          ...record,
          tournamentNumber: source.number,
          tournament: result.tournamentName,
        });
      });

      tournaments.push({
        number: source.number,
        name: result.tournamentName,
        tournamentUrl: source.tournamentUrl,
        bracketUrl: result.bracketUrl,
        matches: result.records.length,
        players: result.players.length,
      });
    });

    // 新しく読み込んだ大会に出てきたUIDだけ名前を最新化する。
    // 未取得大会がない場合はこの処理自体が走らない。
    for (const targetId of Object.values(ACCOUNT_ALIASES)) {
      const id = canonicalId(targetId);
      if (!players.has(id)) continue;
    }

    const currentPlayers = await refreshCurrentPlayerNames([
      ...players.values(),
    ]);

    const names = new Map(
      currentPlayers.map((player) => [String(player.id), player.name])
    );

    records.forEach((record) => {
      record.winner = names.get(String(record.winnerId)) || record.winner;
      record.loser = names.get(String(record.loserId)) || record.loser;
    });

    finishStats(stats);

    return Response.json({
      seriesName: '人形劇',
      source: `${BASE}/user_add_tournament/?user=${USER_ID}`,
      tournaments: tournaments.sort((a, b) => a.number - b.number),
      players: currentPlayers,
      records,
      matches: records.length,
      stats,
      discoveredOnUserPage: allTournaments.length,
      failed,
      upToDate: false,
    });
  } catch (error) {
    console.error('人形劇シリーズ取得エラー', error);

    return Response.json(
      {
        error: '人形劇シリーズの取得に失敗しました。',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}