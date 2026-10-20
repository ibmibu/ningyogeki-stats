import * as cheerio from 'cheerio';
import { smashmateFetch } from '../../../lib/smashmate-request';

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

  // 1件のコメント全体を包む要素を優先する。
  // Smashmateでは投稿者名と本文が別要素に入っている。
  let candidates = $('.comment-body').toArray();
  if (!candidates.length) {
    const root = $('body').length ? $('body') : $.root();
    const blocks = root.find('li, .comment, [class*="comment"], tr').toArray();
    candidates = blocks.length ? blocks : [root.get(0)].filter(Boolean);
  }

  for (const element of candidates) {
    const node = $(element);
    const text = cleanText(node.text());
    if (!text || text.length > 2500) continue;

    const profileLinks = node.find('a[href]').toArray()
      .map(a => $(a))
      .filter(a => /user\/(\d+)/.test(a.attr('href') || ''));
    // アイコン画像のリンクではなく、表示名が入っているリンクを優先する。
    const namedProfile = profileLinks.find(a => cleanText(a.text()));
    const profile = namedProfile || profileLinks[0] || null;
    const href = profile ? profile.attr('href') || '' : '';
    const userId = href.match(/user\/(\d+)/)?.[1] || '';
    // リンクのtext()が空になるHTML差異に備え、同じ行のテキストセルも確認する。
    const rowText = profile ? cleanText(profile.closest('tr').text()) : '';
    const cells = profile ? profile.closest('tr').find('td').toArray().map(td => cleanText($(td).text())) : [];
    const name = cleanText(
      (namedProfile && namedProfile.text()) ||
      profile?.attr('title') ||
      profile?.attr('aria-label') ||
      profile?.find('img').attr('alt') ||
      profile?.find('[title]').first().attr('title') ||
      profile?.find('[aria-label]').first().attr('aria-label') ||
      cells.find(cell => cell && cell !== rowText) ||
      cells.find(Boolean) ||
      ''
    );

    // コメント本文の領域を優先し、投稿者名・日時を本文に混ぜない。
    const commentArea = node.find('.comment-area').first();
    let body = commentArea.length ? cleanText(commentArea.text()) : '';
    if (!body) {
      const clone = node.clone();
      clone.find('a[href], .gray, .comment-header, .comment-date').remove();
      body = cleanText(clone.text());
      if (name && body.startsWith(name)) body = cleanText(body.slice(name.length));
    }
    if (!body || body === text) continue;

    const key = [userId, name, body].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    comments.push({ userId, name, date: '', text: body });
  }

  return { comments };
}

async function getComments(tournament) {
  const id = String(tournament.bracketUrl || '').match(/\/bracket\/(\d+)/)?.[1];
  if (!id) return { number: tournament.number, comments: [], error: '大会IDが見つかりません' };
  try {
    // 60秒間隔の順番待ちが終わってから通信タイムアウトを開始する。
    const response = await smashmateFetch(
      BASE + '/php/ajax/tournament_comment/',
      { method: 'POST', headers: { 'User-Agent': UA, 'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Referer': tournament.bracketUrl }, body: new URLSearchParams({ id, fl: '' }), cache: 'no-store', timeoutMs: 30000 }
    );
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const html = await response.text();
    return { number: tournament.number, bracketId: id, ...parseComments(html) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'コメント取得に失敗しました';
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