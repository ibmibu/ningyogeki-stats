import * as cheerio from 'cheerio';

const BASE = 'https://smashmate.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

const KNOWN_CHARACTERS = [
  'マリオ', 'ドンキーコング', 'リンク', 'サムス', 'ダークサムス', 'ヨッシー', 'カービィ', 'フォックス', 'ピカチュウ', 'ルイージ', 'ネス', 'キャプテン・ファルコン',
  'プリン', 'ピーチ', 'デイジー', 'クッパ', 'アイスクライマー', 'シーク', 'ゼルダ', 'ドクターマリオ', 'ピチュー', 'ファルコ', 'マルス', 'ルキナ', 'こどもリンク',
  'ガノンドロフ', 'ミュウツー', 'ロイ', 'クロム', 'Mr.ゲーム＆ウォッチ', 'メタナイト', 'ピット', 'ブラックピット', 'ゼロスーツサムス', 'ワリオ', 'スネーク', 'アイク',
  'ポケモントレーナー', 'ディディーコング', 'リュカ', 'ソニック', 'デデデ', 'ピクミン＆オリマー', 'ルカリオ', 'ロボット', 'トゥーンリンク', 'ウルフ', 'むらびと',
  'ロックマン', 'Wii Fit トレーナー', 'ロゼッタ＆チコ', 'リトル・マック', 'ゲッコウガ', 'Mii 格闘タイプ', 'Mii 剣術タイプ', 'Mii 射撃タイプ', 'パルテナ', 'パックマン',
  'ルフレ', 'シュルク', 'クッパJr.', 'ダックハント', 'リュウ', 'ケン', 'クラウド', 'カムイ', 'ベヨネッタ', 'インクリング', 'リドリー', 'シモン', 'リヒター',
  'キングクルール', 'しずえ', 'ガオガエン', 'パックンフラワー', 'ジョーカー', '勇者', 'バンジョー＆カズーイ', 'テリー', 'ベレト／ベレス', 'ミェンミェン', 'スティーブ',
  'セフィロス', 'ホムラ／ヒカリ', 'カズヤ', 'ソラ'
];

function cleanText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

function parseComments(html) {
  const $ = cheerio.load(html);
  const comments = [];
  const seen = new Set();
  const selectors = ['.tournament-comment', '.tournament_comment', '.tournament-comment-item', '.tournament_comment_item', '.comment-item', '.comment_item', '.comment-area .comment', '.comment_area .comment', '[class*="tournament-comment"]', '[class*="tournament_comment"]'];
  const nodes = $(selectors.join(','));
  nodes.each((_, element) => {
    const node = $(element);
    if (node.parents().filter((__, parent) => selectors.some((selector) => $(parent).is(selector))).length) return;
    const profile = node.find('a[href]').filter((__, a) => /\/user\/(\d+)\/?(?:[?#].*)?$/.test($(a).attr('href') || '')).first();
    const href = profile.attr('href') || '';
    const userId = href.match(/\/user\/(\d+)\/?(?:[?#].*)?$/)?.[1] || '';
    const name = cleanText(profile.text());
    const clone = node.clone();
    clone.find('a[href]').remove();
    let text = cleanText(clone.text());
    if (name && text.startsWith(name)) text = cleanText(text.slice(name.length));
    if (!text) return;
    const key = [userId, name, text].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    comments.push({ userId, name, date: '', text });
  });
  return { comments, debug: { htmlLength: html.length, profileLinks: $('a[href]').filter((_, a) => /\/user\/\d+/.test($(a).attr('href') || '')).length, commentNodeCount: nodes.length, sampleComments: comments.slice(0, 8).map(({ name, userId, text }) => ({ name, userId, text: text.slice(0, 300) })), responsePreview: cleanText($.root().text()).slice(0, 1200), commentHtmlPreview: nodes.slice(0, 3).map((_, element) => $.html(element).slice(0, 1000)) } };
}

async function getComments(tournament) {
  const id = String(tournament.bracketUrl || '').match(/\/bracket\/(\d+)/)?.[1];
  if (!id) return { number: tournament.number, comments: [], error: '大会IDが見つかりません' };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(BASE + '/php/ajax/tournament_comment/', { method: 'POST', headers: { 'User-Agent': UA, 'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': tournament.bracketUrl }, body: new URLSearchParams({ id, fl: '' }), cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    return { number: tournament.number, bracketId: id, ...parseComments(html) };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? 'コメント取得が12秒でタイムアウトしました' : error instanceof Error ? error.message : 'コメント取得に失敗しました';
    return { number: tournament.number, bracketId: id, comments: [], error: message };
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const tournaments = Array.isArray(payload.tournaments) ? payload.tournaments.slice(0, 150) : [];
    const results = []; let next = 0;
    async function worker() { while (next < tournaments.length) { const index = next++; results[index] = await getComments(tournaments[index]); } }
    await Promise.all(Array.from({ length: Math.min(3, tournaments.length) }, worker));
    return Response.json({ results, count: results.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'コメント取得に失敗しました' }, { status: 500 });
  }
}