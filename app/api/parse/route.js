import * as cheerio from 'cheerio';

function validUrl(value) {
  try { const u = new URL(value); return u.hostname === 'smashmate.net' && /^\/bracket\/\d+\/?$/.test(u.pathname); } catch { return false; }
}

export async function POST(req) {
  try {
    const { url } = await req.json();
    if (!validUrl(url)) return Response.json({error:'Smashmateの /bracket/番号/ URLを入力してください。'}, {status:400});
    const res = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0 (compatible; NingyogekiStats/1.0)'}, cache:'no-store' });
    if (!res.ok) return Response.json({error:`Smashmateから取得できませんでした（${res.status}）`},{status:502});
    const html = await res.text();
    const $ = cheerio.load(html);
    const tournamentName = $('title').text().replace('のトーナメント表 スマメイト','').trim() || '人形劇';
    const players = new Map();
    const records = [];
    $('[data-round] .tour_div_in').each((_, group) => {
      const boxes = $(group).find('.tour_user_box').toArray();
      if (boxes.length !== 2) return;
      const ps = boxes.map(el => ({id:$(el).attr('data-uid'), name:$(el).find('.tour_user_name').text().trim(), result:Number($(el).attr('data-result'))}));
      if (!ps[0].id || !ps[1].id || !ps[0].result || !ps[1].result) return;
      ps.forEach(p=>players.set(p.id,{id:p.id,name:p.name}));
      const winner = ps.find(p=>p.result===1), loser = ps.find(p=>p.result===2);
      const round = $(group).closest('[data-round]').attr('data-round');
      records.push({winner:winner.name, loser:loser.name, winnerId:winner.id, loserId:loser.id, round});
    });
    const stats = {};
    for (const r of records) {
      stats[r.winnerId] ??= {}; stats[r.loserId] ??= {};
      stats[r.winnerId][r.loserId] ??= {wins:0,losses:0};
      stats[r.loserId][r.winnerId] ??= {wins:0,losses:0};
      stats[r.winnerId][r.loserId].wins++;
      stats[r.loserId][r.winnerId].losses++;
    }
    for (const a of Object.keys(stats)) for (const b of Object.keys(stats[a])) {
      const s=stats[a][b]; const total=s.wins+s.losses; s.rate=Math.round((s.wins/total)*1000)/10;
    }
    return Response.json({tournamentName, players:[...players.values()], records, matches:records.length, stats});
  } catch (e) { return Response.json({error:'解析中にエラーが発生しました。', detail:e.message},{status:500}); }
}
