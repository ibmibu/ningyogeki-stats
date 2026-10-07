'use client';
import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('https://smashmate.net/bracket/21446/');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function parse() {
    setLoading(true); setError(''); setData(null);
    try {
      const res = await fetch('/api/parse', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '解析に失敗しました');
      setData(json);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return <main className="wrap">
    <h1>人形劇 戦績表</h1>
    <p className="lead">Smashmateの大会ページから、選手同士の直接対戦成績を集計します。</p>
    <div className="card">
      <label>Smashmate トーナメントURL</label>
      <div className="row"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://smashmate.net/bracket/.../"/><button onClick={parse} disabled={loading}>{loading?'解析中…':'集計する'}</button></div>
      <small>現在はまず1大会の解析版です。動作確認後、「人形劇」を含む大会を自動でまとめて集計する機能を追加します。</small>
    </div>
    {error && <div className="error">{error}</div>}
    {data && <>
      <div className="summary"><b>{data.tournamentName}</b><span>{data.matches} 試合 / {data.players.length} 人</span></div>
      <div className="tableWrap"><table><thead><tr><th></th>{data.players.map(p=><th key={p.id}>{p.name}</th>)}</tr></thead><tbody>{data.players.map(r=><tr key={r.id}><th>{r.name}</th>{data.players.map(c=>{const s=data.stats[r.id]?.[c.id]; if(r.id===c.id)return <td key={c.id} className="dash">—</td>; if(!s)return <td key={c.id}>-</td>; return <td key={c.id}><strong>{s.rate}%</strong><br/><small>{s.wins}-{s.losses}</small></td>})}</tr>)}</tbody></table></div>
      <details><summary>取得した対戦結果</summary><ul>{data.records.map((m,i)=><li key={i}>{m.winner} ○ vs × {m.loser} <small>（{m.round}）</small></li>)}</ul></details>
    </>}
  </main>;
}
