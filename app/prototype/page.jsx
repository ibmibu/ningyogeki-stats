'use client';

import { useMemo, useState } from "react";

const sample = [
  { id: 1, title: "人形劇 #135", host: "人形劇運営", rule: "無強化 amiibo", date: "10/31(土) 20:00", status: "募集中", count: 18, max: 32, tag: "定期大会" },
  { id: 2, title: "秋のamiiboトーナメント", host: "figurecup", rule: "レベル50・スピリッツあり", date: "11/02(月) 21:00", status: "募集中", count: 9, max: 16, tag: "スピリッツあり" },
  { id: 3, title: "ルール自由研究会 vol.3", host: "amiibo Lab", rule: "カスタムルール", date: "11/05(木) 19:30", status: "まもなく開催", count: 12, max: 12, tag: "特殊ルール" },
];

export default function FigureTournamentPrototype() {
  const [tab, setTab] = useState("すべて");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const filtered = useMemo(() => sample.filter((t) =>
    (tab === "すべて" || tab === t.status || tab === t.tag) &&
    (t.title + t.host + t.rule + t.tag).toLowerCase().includes(query.toLowerCase())
  ), [tab, query]);

  return <main className="page">
    <style jsx global>{`
      * { box-sizing: border-box; }
      body { margin:0; background:#0d0e14; color:#f4f3f8; font-family:Inter,"Noto Sans JP",system-ui,sans-serif; }
      button,input,select,textarea { font:inherit; }
      button { cursor:pointer; }
    `}</style>
    <style jsx>{`
      .page{min-height:100vh;background:radial-gradient(ellipse at 50% -15%,#29203d 0,#0d0e14 48%);color:#f4f3f8}
      .wrap{max-width:1120px;margin:auto;padding:0 24px}
      header{border-bottom:1px solid #292a35;background:#101117}
      .nav{height:74px;display:flex;align-items:center;justify-content:space-between;gap:16px}
      .brand{display:flex;align-items:center;gap:11px;font-weight:900;font-size:18px}
      .logo{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(135deg,#b56bf1,#6c4fdb);font-size:20px}
      nav{display:flex;align-items:center;gap:22px;font-size:13px;color:#b7b4c4}
      nav a{color:inherit;text-decoration:none}
      .btn{border:1px solid #3b3748;border-radius:10px;padding:11px 15px;background:#191821;color:#f5f1fc;font-weight:750;font-size:12px}
      .primary{border:0;background:linear-gradient(135deg,#a65de5,#7050df)}
      .hero{display:grid;grid-template-columns:1.1fr .9fr;gap:28px;align-items:center;padding:60px 0 34px}
      .eyebrow{color:#c79af5;font-size:11px;font-weight:850;letter-spacing:.18em}
      h1{font-size:clamp(36px,5vw,56px);line-height:1.16;letter-spacing:-.05em;margin:14px 0}
      h1 span{color:#bd85f2}
      .lead{color:#aaa7b8;line-height:1.9;font-size:14px}
      .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
      .art{padding:22px;border:1px solid #383044;border-radius:22px;background:linear-gradient(145deg,#211a31,#12131a)}
      .artlabel{color:#aaa2b8;font-size:10px;letter-spacing:.16em}
      .versus{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin-top:25px}
      .fighter{border:1px solid #41354f;border-radius:15px;background:#18151f;padding:17px 8px;text-align:center}
      .symbol{height:62px;width:62px;display:grid;place-items:center;margin:0 auto 10px;border-radius:17px;background:#332644;font-size:27px}
      .fighter strong{display:block;font-size:13px}.fighter small{display:block;color:#8e899e;font-size:10px;margin-top:5px}
      .vs{color:#c28cf2;font-weight:950;font-style:italic}
      .metrics{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #292a35;border-radius:13px;background:#12131a;margin-bottom:44px}
      .metric{padding:17px 20px;border-right:1px solid #292a35}.metric:last-child{border:0}
      .metric strong{display:block;font-size:19px}.metric span{color:#8f8c9d;font-size:11px}
      .section{padding-bottom:48px}.head{display:flex;justify-content:space-between;align-items:end;gap:14px;margin-bottom:18px}
      h2{font-size:22px;letter-spacing:-.04em;margin:7px 0}.sub{color:#8f8c9d;font-size:12px;margin:7px 0}
      .tools{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}.search{flex:1;min-width:200px}
      input{width:100%;padding:12px 14px;border:1px solid #32313e;border-radius:10px;background:#14151c;color:white;outline:none}
      input:focus{border-color:#9f69e4}.filters{display:flex;gap:6px;flex-wrap:wrap}
      .filter{border:1px solid #32313e;border-radius:9px;padding:10px 12px;background:#14151c;color:#aaa7b7;font-size:12px}
      .filter.active{background:#4d326d;border-color:#a56ce8;color:#fff}
      .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
      .card{border:1px solid #2d2e39;border-radius:15px;padding:18px;background:linear-gradient(145deg,#181922,#121319);min-width:0}
      .top{display:flex;justify-content:space-between;align-items:center;gap:8px}.tag{color:#c7a0ef;background:#8d5ac21c;border:1px solid #744ca533;border-radius:6px;padding:5px 8px;font-size:10px;font-weight:800}
      .status{color:#7cdaa5;font-size:10px}.soon{color:#f2c778}
      h3{font-size:17px;margin:16px 0 5px;line-height:1.45}.host{color:#8f8c9d;font-size:11px}
      .rule{margin:16px 0;padding:10px;background:#ffffff07;border-radius:8px;font-size:12px;color:#cbc6d5}
      .meta{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #2b2b36;padding:12px 0;color:#aaa7b7;font-size:11px}
      .bar{height:5px;border-radius:99px;background:#2b2935;overflow:hidden;margin-bottom:15px}.bar i{display:block;height:100%;background:linear-gradient(90deg,#7655d8,#c17cf1)}
      .bottom{display:flex;align-items:center;justify-content:space-between;gap:8px}.bottom small{color:#8f8c9d;font-size:10px}
      .empty{grid-column:1/-1;text-align:center;padding:36px;color:#aaa7b7;border:1px dashed #393643;border-radius:12px}
      .lower{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding-bottom:50px}.panel{border:1px solid #2b2c37;border-radius:15px;padding:20px;background:#14151c}
      .row{display:flex;align-items:center;gap:12px;border-top:1px solid #2a2b35;padding:15px 0}.ico{width:40px;height:40px;display:grid;place-items:center;border-radius:11px;background:#2a2138;color:#c99bf2;font-size:18px;flex-shrink:0}
      .row strong{font-size:13px;display:block}.row small{color:#8f8c9d;font-size:11px;display:block;margin-top:4px}
      footer{border-top:1px solid #292a35;padding:25px 0 35px;color:#777486;font-size:10px}
      .modalShade{position:fixed;inset:0;z-index:5;background:#050509cc;display:grid;place-items:center;padding:20px}
      .modal{width:min(500px,100%);padding:24px;border:1px solid #484052;border-radius:18px;background:#191922;box-shadow:0 20px 80px #0009}
      .modal h2{margin:0 0 8px}.modal p{font-size:12px;line-height:1.7;color:#aaa7b7}
      .field{display:grid;gap:7px;margin:13px 0}.field label{font-size:12px;color:#c9c4d4}
      .field input,.field select,.field textarea{padding:11px;border:1px solid #393744;border-radius:9px;background:#101117;color:white;width:100%}
      .modalActions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
      .note{font-size:11px;line-height:1.6;color:#e7c98e;border:1px solid #6d552f;background:#9b702014;padding:11px;border-radius:9px}
      @media(max-width:850px){.hero{grid-template-columns:1fr;padding-top:40px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.lower{grid-template-columns:1fr}nav{gap:12px}}
      @media(max-width:560px){.wrap{padding:0 15px}.nav{height:64px}.brand{font-size:15px}nav a{display:none}nav .btn{padding:9px;font-size:11px}.hero{padding-top:32px;gap:22px}.lead{font-size:13px}.art{padding:15px}.symbol{width:52px;height:52px}.metric{padding:13px 9px}.metric strong{font-size:16px}.metric span{font-size:9px}.metrics{margin-bottom:34px}.head{align-items:start}.head h2{font-size:19px}.head .btn{padding:9px}.cards{grid-template-columns:1fr}.filters{flex-wrap:nowrap;overflow-x:auto;width:100%;padding-bottom:4px}.filter{white-space:nowrap}.panel{padding:16px}}
    `}</style>
    <header><div className="wrap nav">
      <div className="brand"><div className="logo">F</div><div>Figure Tournament</div></div>
      <nav><a href="#tournaments">大会を探す</a><a href="#stats">戦績・ランキング</a><a href="#tools">ツール</a><button className="btn primary" onClick={() => setCreateOpen(true)}>＋ 大会を作成</button></nav>
    </div></header>
    <div className="wrap">
      <section className="hero"><div>
        <div className="eyebrow">THE HOME OF AMIIBO BATTLES</div>
        <h1>amiiboの大会を、<br/><span>もっと自由に。</span></h1>
        <p className="lead">大会を探す。参加する。戦績を残す。<br/>人形劇の戦績も、新しい大会も、ここからひとつに。</p>
        <div className="actions"><a href="#tournaments"><button className="btn primary">開催中の大会を探す ↓</button></a><button className="btn" onClick={() => setCreateOpen(true)}>大会を主催する ＋</button></div>
      </div><div className="art"><div className="artlabel">FEATURED MATCH · AMIIBO BATTLE</div><div className="versus">
        <div className="fighter"><div className="symbol">⚔</div><strong>ルカリオ</strong><small>TRAINER · IBU</small></div><div className="vs">VS</div><div className="fighter"><div className="symbol">✦</div><strong>ウルフ</strong><small>TRAINER · SUNDUBU</small></div>
      </div></div></section>
      <section className="metrics"><div className="metric"><strong>AMIIBO ONLY</strong><span>amiibo大会に特化</span></div><div className="metric"><strong>FLEXIBLE RULES</strong><span>大会ごとのルールに対応</span></div><div className="metric"><strong>STATS + TOOLS</strong><span>戦績もステージ選択も</span></div></section>
      <section className="section" id="tournaments"><div className="head"><div><div className="eyebrow">FIND YOUR NEXT BATTLE</div><h2>開催される大会を探す</h2><p className="sub">気になる大会を見つけて、参加しよう。</p></div><button className="btn primary" onClick={() => setCreateOpen(true)}>＋ 大会を作成</button></div>
        <div className="tools"><div className="search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="大会名・主催者・ルールで検索"/></div><div className="filters">{["すべて","募集中","定期大会","スピリッツあり","特殊ルール"].map((x) => <button key={x} className={"filter"+(tab===x?" active":"")} onClick={() => setTab(x)}>{x}</button>)}</div></div>
        <div className="cards">{filtered.length ? filtered.map((t) => <article className="card" key={t.id}><div className="top"><span className="tag">{t.tag}</span><span className={"status"+(t.status!=="募集中"?" soon":"")}>● {t.status}</span></div><h3>{t.title}</h3><div className="host">主催：{t.host}</div><div className="rule">ルール：{t.rule}</div><div className="meta"><span>◷ {t.date}</span><span>シングル</span></div><div className="meta" style={{borderTop:0,paddingTop:0}}><span>参加人数</span><strong>{t.count} / {t.max} 人</strong></div><div className="bar"><i style={{width:(t.count/t.max*100)+"%"}}/></div><div className="bottom"><small>参加枠 {t.max-t.count} 人</small><button className="btn" onClick={() => setDetail(t)}>大会を見る →</button></div></article>) : <div className="empty">条件に合う大会がありません。検索やフィルターを変更してください。</div>}</div>
      </section>
      <section className="lower" id="stats"><div className="panel"><h2>戦績・ランキング</h2><div className="row"><div className="ico">↗</div><div><strong>人形劇 戦績データ</strong><small>大会記録・対戦履歴を確認</small></div><button className="btn" style={{marginLeft:"auto"}} onClick={() => alert("既存の人形劇戦績サイトとの接続は統合段階で行います。")}>開く ↗</button></div><div className="row"><div className="ico">♜</div><div><strong>amiiboランキング</strong><small>大会結果をもとにしたランキング</small></div><span style={{marginLeft:"auto",fontSize:10,color:"#8f8c9d"}}>準備中</span></div><p className="note">※ 大会・ランキングは画面確認用のサンプルです。実データとは連動していません。</p></div>
      <div className="panel" id="tools"><h2>大会で使えるツール</h2><div className="row"><div className="ico">▦</div><div><strong>ステージストライク</strong><small>対戦ステージの選択・拒否をスムーズに</small></div><button className="btn" style={{marginLeft:"auto"}} onClick={() => alert("ステージストライクとの統合は次の段階で行います。")}>開く ↗</button></div><div className="row"><div className="ico">⚙</div><div><strong>大会ルール設定</strong><small>BO3 / BO5・ステージ・参加条件</small></div><span style={{marginLeft:"auto",fontSize:10,color:"#8f8c9d"}}>準備中</span></div></div></section>
    </div>
    <footer><div className="wrap">© Figure Tournament · Prototype <span style={{float:"right"}}>amiibo tournament / stats / tools</span></div></footer>
    {(createOpen || detail) && <div className="modalShade" onMouseDown={(e) => {if(e.target===e.currentTarget){setCreateOpen(false);setDetail(null)}}}><div className="modal">
      {createOpen ? <><h2>大会を作成する</h2><p>大会作成画面のイメージです。今は入力・保存は行われません。</p><div className="field"><label>大会名</label><input placeholder="例：第1回 ○○ amiibo杯"/></div><div className="field"><label>大会形式</label><select defaultValue="single"><option value="single">シングルエリミネーション</option><option>総当たり</option><option>リーグ戦</option></select></div><div className="field"><label>ルール・参加条件</label><textarea rows={3} placeholder="レベル、スピリッツ、使用 amiibo など"/></div><div className="note">この段階では見た目だけの試作です。大会の公開・募集・参加登録はまだありません。</div><div className="modalActions"><button className="btn" onClick={() => setCreateOpen(false)}>閉じる</button><button className="btn primary" onClick={() => {setCreateOpen(false);alert("試作画面なので保存は行われません。")}}>確認</button></div></> : <><h2>{detail.title}</h2><p>主催：{detail.host} ／ {detail.date}</p><div className="field"><label>大会ルール</label><input value={detail.rule} readOnly/></div><div className="field"><label>参加人数</label><input value={detail.count+" / "+detail.max+" 人"} readOnly/></div><div className="note">これは仮データです。参加登録機能はまだありません。</div><div className="modalActions"><button className="btn" onClick={() => setDetail(null)}>閉じる</button><button className="btn primary" onClick={() => {setDetail(null);alert("参加機能はまだ実装されていません。")}}>参加する</button></div></>}
    </div></div>}
  </main>;
}
