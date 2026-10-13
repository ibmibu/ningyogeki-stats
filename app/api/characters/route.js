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

    // コメント単位の要素から投稿者と本文を取得する。本文にキャラ名がなくても診断用にコメント自体は保持する。
    const commentNodes = $('.tournament-comment');
    commentNodes.each((_, element) => {
      const node = $(element);
        /\/user\/(\d+)\/?(?:[?#].*)?$/.test($(a).attr('href') || '')
        /\\/user\\/(\\d+)\\/?(?:[?#].*)?$/.test($(a).attr('href') || '')
      ).first();
      const userId = href.match(/\/user\/(\d+)\/?(?:[?#].*)?$/)?.[1] || '';
      const name = profile.text().replace(/\s+/g, ' ').trim();
      const name = profile.text().replace(/\\s+/g, ' ').trim();
      const text = clone.text().replace(/\s+/g, ' ').trim();
      clone.find('a[href]').remove();
      const text = clone.text().replace(/\\s+/g, ' ').trim();
      if (!text) return;
      const key = [userId, name, text].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      comments.push({ userId, name, date: '', text });
    });

    return {
      number: tournament.number,
      bracketId: id,
      comments,
      debug: {
        htmlLength: html.length,
        profileLinks: $('a[href]').filter((_, a) => /\/user\/\d+/.test($(a).attr('href') || '')).length,
        commentNodeCount: commentNodes.length,\n        sampleComments: comments.slice(0, 5).map(({ name, userId, text }) => ({ name, userId, text: text.slice(0, 300) })),\n        responsePreview: $.root().text().replace(/\\s+/g, ' ').trim().slice(0, 1200),
        sampleProfileHtml: (() => {
          const link = $('a[href]').filter((_, a) => /\/user\/\d+/.test($(a).attr('href') || '')).first();
          return link.length ? [link, link.parent(), link.parent().parent(), link.parent().parent().parent()].map((node) => node.toString().slice(0, 1200)) : [];
        })()
      }
    };
  } catch (error) {
        commentNodeCount: commentNodes.length,
        sampleComments: comments.slice(0, 5).map(({ name, userId, text }) => ({ name, userId, text: text.slice(0, 300) })),
        responsePreview: $.root().text().replace(/\s+/g, ' ').trim().slice(0, 1200),

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
}    const knownCharacters = [
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

    // 各コメント要素から投稿者名と本文をまとめて取得する
    const commentNodes = $('.tournament-comment');
    commentNodes.each((_, element) => {
      const node = $(element);
      const profile = node.find('a[href]').filter((__, a) =>
        /\/user\/(\d+)\/?(?:[?#].*)?$/.test($(a).attr('href') || '')
      ).first();
      const href = profile.attr('href') || '';
      const userId = href.match(/\/user\/(\d+)\/?(?:[?#].*)?$/)?.[1] || '';
      const name = profile.text().replace(/\s+/g, ' ').trim();
      const clone = node.clone();
      clone.find('a[href]').remove();
      const text = clone.text().replace(/\s+/g, ' ').trim();
      if (!text) return;
      const key = [userId, name, text].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      comments.push({ userId, name, date: '', text });
    });

    return {
      number: tournament.number,
      bracketId: id,
      comments,
      debug: {
        htmlLength: html.length,
        profileLinks: $('a[href]').filter((_, a) => /\/user\/\d+/.test($(a).attr('href') || '')).length,
        commentNodeCount: commentNodes.length,
        sampleComments: comments.slice(0, 5).map(({ name, userId, text }) => ({ name, userId, text: text.slice(0, 300) })),
        responsePreview: $.root().text().replace(/\s+/g, ' ').trim().slice(0, 1200)
      }
    };
  } catch (error) {
        commentNodeCount: commentNodes.length,
        sampleComments: comments.slice(0, 5).map(({ name, userId, text }) => ({ name, userId, text: text.slice(0, 300) })),
        responsePreview: $.root().text().replace(/\s+/g, ' ').trim().slice(0, 1200),

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
