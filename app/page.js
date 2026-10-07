'use client';

import { useEffect, useState } from 'react';

export default function Home() {
  const [data, setData] =
    useState(null);

  const [error, setError] =
    useState(null);

  useEffect(() => {
    fetch('/api/series')
      .then(async (res) => {
        const json =
          await res.json();

        if (!res.ok) {
          throw new Error(
            json.detail ||
              json.error ||
              '取得失敗'
          );
        }

        return json;
      })
      .then(setData)
      .catch((e) =>
        setError(e.message)
      );
  }, []);

  if (error) {
    return (
      <main
        style={{
          padding: 40,
          fontFamily: 'sans-serif',
        }}
      >
        <h1>人形劇 戦績表</h1>

        <p style={{ color: 'red' }}>
          {error}
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main
        style={{
          padding: 40,
          fontFamily: 'sans-serif',
        }}
      >
        <h1>人形劇 戦績表</h1>
        <p>人形劇を取得中...</p>
      </main>
    );
  }

  return (
    <main
      style={{
        padding: 40,
        fontFamily: 'sans-serif',
        maxWidth: 900,
        margin: '0 auto',
      }}
    >
      <h1>人形劇 戦績表</h1>

      <h2>
        {data.count}大会取得
      </h2>

      <p>
        最新：人形劇#
        {data.latest}
      </p>

      <p>
        最古：人形劇#
        {data.oldest}
      </p>

      <hr />

      {data.tournaments.map(
        (tournament) => (
          <div
            key={tournament.number}
            style={{
              padding: '12px 0',
              borderBottom:
                '1px solid #ddd',
            }}
          >
            <strong>
              {tournament.name}
            </strong>

            <br />

            大会ID：
            {tournament.tournamentId}

            <br />

            {tournament.bracketUrl ? (
              <a
                href={
                  tournament.bracketUrl
                }
                target="_blank"
                rel="noreferrer"
              >
                トーナメント表
              </a>
            ) : (
              <span>
                トーナメント表なし
              </span>
            )}
          </div>
        )
      )}
    </main>
  );
}
