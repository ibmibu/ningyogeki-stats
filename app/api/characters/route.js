import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

async function getComments(tournament) {
  const id = String(tournament.bracketUrl || '').match(/\/bracket\/(\d+)/)?.[1];
  if (!id) return { number: tournament.number, comments: [], error: '大会IDが見つかりません' };

  try {
    const body = new URLSearchParams({ id, fl: '' });
    const response = await fetch(`${BASE}/php/ajax/tournament_comment/`, {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': tournament.bracketUrl,
      },
      body,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    const comments = [];
    $('.comment-body').each((_, element) => {
      const item = $(element);
      const profile = item.find('a[href*="/user/"]').filter((__, a) => /\/user\/\d+\/?/.test($(a).attr('href') || '')).first();
      const userId = (profile.attr('href') || '').match(/\/user\/(\d+)/)?.[1];
      const name = profile.text().replace(/\s+/g, ' ').trim();
      const date = item.find('.text-right.gray').first().text().replace(/\s+/g, ' ').trim();
      const text = item.find('.comment-area').text().replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
      if (userId && text) comments.push({ userId, name, date, text });
    });
    return { number: tournament.number, comments };
  } catch (error) {
    return { number: tournament.number, comments: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const tournaments = Array.isArray(payload.tournaments) ? payload.tournaments.slice(0, 150) : [];
    const results = [];
    let next = 0;
    async function worker() {
      while (next < tournaments.length) {
        const index = next++;
        results[index] = await getComments(tournaments[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, tournaments.length) }, worker));
    return Response.json({ results, count: results.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'コメント取得に失敗しました' }, { status: 500 });
  }
}
