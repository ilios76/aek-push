const { schedule } = require("@netlify/functions");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstashSet(key, value) {
  await fetch(`${UPSTASH_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: JSON.stringify(value),
  });
}

const handler = async () => {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const TEAM_ID = process.env.AEK_TEAM_ID;

  const res = await fetch(
    `https://v3.football.api-sports.io/fixtures?team=${TEAM_ID}&next=10`,
    { headers: { "x-apisports-key": API_KEY } }
  );
  const data = await res.json();

  const fixtures = (data.response || []).map((f) => ({
    id: f.fixture.id,
    kickoff: f.fixture.date,
    home: f.teams.home.name,
    away: f.teams.away.name,
    homeId: f.teams.home.id,
    awayId: f.teams.away.id,
  }));

  await upstashSet("aek-upcoming-fixtures", fixtures);

  console.log("Saved", fixtures.length, "upcoming fixtures");

  return { statusCode: 200 };
};

module.exports.handler = schedule("0 3 * * *", handler);
