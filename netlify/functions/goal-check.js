const { schedule } = require("@netlify/functions");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const AEK_ESPN_ID = "887";

async function upstashGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  return json.result ? JSON.parse(json.result) : null;
}

async function upstashSet(key, value) {
  await fetch(`${UPSTASH_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: JSON.stringify(value),
  });
}

const handler = async () => {
  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/soccer/gre.1/scoreboard"
  );
  const data = await res.json();

  const events = data.events || [];
  const aekEvent = events.find((ev) =>
    ev.competitions[0].competitors.some((c) => c.team.id === AEK_ESPN_ID)
  );

  if (!aekEvent) {
    console.log("Δεν βρέθηκε σημερινός αγώνας ΑΕΚ.");
    return { statusCode: 200 };
  }

  const competition = aekEvent.competitions[0];
  const state = competition.status.type.state; // "pre" | "in" | "post"

  if (state !== "in") {
    console.log("Ο αγώνας ΑΕΚ δεν είναι live αυτή τη στιγμή (status:", state, ")");
    return { statusCode: 200 };
  }

  const aekCompetitor = competition.competitors.find((c) => c.team.id === AEK_ESPN_ID);
  const opponent = competition.competitors.find((c) => c.team.id !== AEK_ESPN_ID);
  const aekGoals = Number(aekCompetitor.score);

  const stateKey = `aek-goal-state-${aekEvent.id}`;
  const prevState = (await upstashGet(stateKey)) || { aekGoals: 0 };

  if (aekGoals > prevState.aekGoals) {
    const scoreLine = `${aekCompetitor.score}-${opponent.score}`;
    const clock = competition.status.displayClock;
    const opponentName = opponent.team.shortDisplayName || opponent.team.displayName;

    await fetch("https://superb-pie-79e20a.netlify.app/.netlify/functions/push-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "ΓΚΟΛ ΑΕΚ! ⚽🟡⚫",
        body: `ΑΕΚ ${scoreLine} ${opponentName} (${clock})`,
      }),
    });
    console.log("Goal push sent:", scoreLine);
  }

  await upstashSet(stateKey, { aekGoals });

  return { statusCode: 200 };
};

module.exports.handler = schedule("*/2 * * * *", handler);
