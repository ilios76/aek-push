const { schedule } = require("@netlify/functions");
const { getStore } = require("@netlify/blobs");

function isWithinMatchWindow(kickoffIso) {
  const kickoff = new Date(kickoffIso).getTime();
  const now = Date.now();
  const windowStart = kickoff - 5 * 60 * 1000; // 5' πριν
  const windowEnd = kickoff + 130 * 60 * 1000; // κάλυψη + παράταση
  return now >= windowStart && now <= windowEnd;
}

const handler = async () => {
  const API_KEY = process.env.API_FOOTBALL_KEY;
  const TEAM_ID = Number(process.env.AEK_TEAM_ID);
  const store = getStore("aek-goals");

  const fixtures = (await store.get("upcoming-fixtures", { type: "json" })) || [];
  const live = fixtures.find((f) => isWithinMatchWindow(f.kickoff));

  if (!live) {
    console.log("Δεν παίζει η ΑΕΚ αυτή τη στιγμή — καμία κλήση API.");
    return { statusCode: 200 };
  }

  const res = await fetch(
    `https://v3.football.api-sports.io/fixtures?id=${live.id}`,
    { headers: { "x-apisports-key": API_KEY } }
  );
  const data = await res.json();
  const fixture = data.response && data.response[0];
  if (!fixture) return { statusCode: 200 };

  const isHome = fixture.teams.home.id === TEAM_ID;
  const aekGoals = isHome ? fixture.goals.home : fixture.goals.away;
  const opponent = isHome ? fixture.teams.away.name : fixture.teams.home.name;

  const stateKey = `goal-state-${live.id}`;
  const prevState = (await store.get(stateKey, { type: "json" })) || { aekGoals: 0 };

  if (aekGoals > prevState.aekGoals) {
    const scoreLine = isHome
      ? `${fixture.goals.home}-${fixture.goals.away}`
      : `${fixture.goals.away}-${fixture.goals.home}`;
    const minute = fixture.fixture.status.elapsed;

    await fetch("https://superb-pie-79e20a.netlify.app/.netlify/functions/push-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "ΓΚΟΛ ΑΕΚ! ⚽🟡⚫",
        body: `ΑΕΚ ${scoreLine} ${opponent} (${minute}')`,
      }),
    });
    console.log("Goal push sent:", scoreLine);
  }

  await store.setJSON(stateKey, { aekGoals });

  return { statusCode: 200 };
};

// Τρέχει κάθε 2 λεπτά — αλλά κάνει πραγματικό API call μόνο μέσα σε παράθυρο αγώνα
module.exports.handler = schedule("*/2 * * * *", handler);
