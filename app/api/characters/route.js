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
    const knownCharacters = [
      'マリオ', 'ドンキーコング', 'リンク', 'サムス', 'ダークサムス', 'ヨッシー',
      'カービィ', 'フォックス', 'ピカチュウ', 'ルイージ', 'ネス', 'キャプテン・ファルコン',
      'プリン', 'ピーチ', 'デイジー', 'クッパ', 'アイスクライマー', 'シーク', 'ゼルダ',
      'ドクターマリオ', 'ピチュー', 'ファルコ', 'マルス', 'ルキナ', 'こどもリンク',
      'ガノンドロフ', 'ミュウツー', 'ロイ', 'クロム', 'Mr.ゲーム＆ウォッチ', 'メタナイト',
      'ピット', 'ブラックピット', 'ゼロスーツサムス', 'ワリオ', 'スネーク', 'アイク',
      'ポケモントレーナー', 'ディディーコング', 'リュカ', 'ソニック', 'デデデ',
      'ピクミン＆オリマー', 'ルカリオ', 'ロボット', 'トゥーンリンク', 'ウルフ', 'むらびと',
      'ロックマン', 'Wii Fit トレーナー', 'ロゼッタ＆チコ', 'リトル・マック', 'ゲッコウガ',
      'Mii 格闘タイプ', 'Mii 剣術タイプ', 'Mii 射撃タイプ', 'パルテナ', 'パックマン',
      'ルフレ', 'シュルク', 'クッパJr.', 'ダックハント', 'リュウ', 'ケン', 'クラウド',
      'カムイ', 'ベヨネッタ', 'インクリング', 'リドリー', 'シモン', 'リヒター',
      'キングクルール', 'しずえ', 'ガオガエン', 'パックンフラワー', 'ジョーカー', '勇者',
      'バンジョー＆カズーイ', 'テリー', 'ベレト／ベレス', 'ミェンミェン', 'スティーブ',
      'セフィロス', 'ホムラ／ヒカリ', 'カズヤ', 'ソラ'
    ];
    const containsFighter = (value) => knownCharacters.some((fighter) => value.includes(fighter));

    // コメント本文を含む最小の要素を探す。プロフィール名だけの要素は本文として採用しない。
    $('*').each((_, element) => {
      const node = $(element);
      if (node.children().length > 8) return;
      const fullText = node.text().replace(/\s+/g, ' ').trim();
      if (!fullText || fullText.length > 500 || !containsFighter(fullText)) return;

      const parent = node.parent();
      if (parent.length && parent.text().replace(/\s+/g, ' ').trim().length <= fullText.length + 40 &&
          containsFighter(parent.text().replace(/\s+/g, ' ').trim())) return;

      const profile = node.closest('li, .comment, .comment-item, .tournament-comment, .comment-area, tr, div')
        .find('a[href]').filter((__, a) => /\\/user\\/(\d+)\\/?(?:[?#].*)?$/.test($(a).attr('href') || '')).first();
      const href = profile.attr('href') || '';
      const userId = href.match(/\\/user\\/(\d+)\\/?(?:[?#].*)?$/)?.[1] || '';
      const name = profile.text().replace(/\s+/g, ' ').trim();
      let text = fullText;
      if (name) text = text.replace(name, '').trim();
      text = text.replace(/\s+/g, ' ').trim();
      if (!text || !containsFighter(text)) return;

      const key = [userId, text].join('|');
      if (!seen.has(key)) {
        seen.add(key);
        comments.push({ userId, name, date: '', text });
      }
    });

    return {
      number: tournament.number,
      bracketId: id,
      comments,
      debug: {
        htmlLength: html.length,
        profileLinks: $('a[href]').filter((_, a) => /\/user\/\d+/.test($(a).attr('href') || '')).length,
        sampleComments: comments.slice(0, 3).map(({ name, text }) => ({ name, text: text.slice(0, 300) })),
        sampleProfileHtml: (() => {
          const link = $('a[href]').filter((_, a) => /\/user\/\d+/.test($(a).attr('href') || '')).first();
          return link.length ? [link, link.parent(), link.parent().parent(), link.parent().parent().parent()].map((node) => node.toString().slice(0, 1200)) : [];
        })()
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
