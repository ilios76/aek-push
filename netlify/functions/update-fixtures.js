const { schedule } = require("@netlify/functions");
const { getStore } = require("@netlify/blobs");

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

  const store = getStore("aek-goals");
  await store.setJSON("upcoming-fixtures", fixtures);

  console.log("Saved", fixtures.length, "upcoming fixtures");

  return { statusCode: 200 };
};

// Τρέχει κάθε μέρα στις 03:00 UTC (~06:00 ώρα Ελλάδας)
module.exports.handler = schedule("0 3 * * *", handler);
