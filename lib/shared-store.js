const REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const TOURNAMENT_SET_KEY = 'ningyogeki:series:tournament-numbers';

function isConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

/**
 * Persist a successfully fetched tournament without making Redis a dependency
 * of the existing stats API response.
 */
export async function saveTournamentToSharedStore(tournament) {
  if (!isConfigured()) {
    return { saved: false, reason: 'Redis REST environment variables are missing' };
  }

  const key = `ningyogeki:series:tournament:${Number(tournament.number)}`;
  const commands = [
    ['SET', key, JSON.stringify(tournament)],
    ['SADD', TOURNAMENT_SET_KEY, String(Number(tournament.number))],
  ];

  const response = await fetch(`${REST_URL.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
    cache: 'no-store',
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) {
    throw new Error(`Redis HTTP ${response.status}`);
  }

  const results = await response.json();
  const failed = Array.isArray(results)
    ? results.find((result) => result?.error)
    : null;

  if (failed) {
    throw new Error(String(failed.error));
  }

  return { saved: true };
}
