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
    const seen = new Set();

    // SmashmateのHTML構造変更に備え、ユーザープロフィールリンクを起点にコメント領域を探す。
    $('a[href]').each((_, anchor) => {
      const href = $(anchor).attr('href') || '';
      const userId = href.match(/\/user\/(\d+)\/?(?:[?#].*)?$/)?.[1];
      if (!userId) return;

      const profile = $(anchor);
      const name = profile.text().replace(/\s+/g, ' ').trim();
      let container = profile;
      let text = '';
      let date = '';

      for (let depth = 0; depth < 6 && container.length; depth += 1) {
        const candidate = container.text().replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
        const hasCharacterReport = /[0-9０-９]{1,2}\s*[pPｐＰ]/.test(candidate);
        if (candidate.length > name.length && candidate.length < 1500 && (hasCharacterReport || depth >= 2)) {
          text = container.find('.comment-area').text().trim() || container.find('p').text().trim() || candidate;
          date = container.find('.text-right.gray, time, [datetime]').first().text().replace(/\s+/g, ' ').trim();
          if (text && text !== name) break;
        }
        container = container.parent();
      }

      text = text.replace(name, '').replace(/\s+/g, ' ').trim();
      const key = userId + '|' + text;
      if (text && text.length <= 1500 && !seen.has(key)) {
        seen.add(key);
        comments.push({ userId, name, date, text });
      }
    });

    return {
      number: tournament.number,
      bracketId: id,
      comments,
      debug: {
        htmlLength: html.length,
        profileLinks: $('a[href]').filter((_, a) => /\/user\/\d+/.test($(a).attr('href') || '')).length,
        sampleComments: comments.slice(0, 3).map(({ name, text }) => ({ name, text: text.slice(0, 300) }))
      }
    };
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
