const { schedule } = require("@netlify/functions");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const AEK_ESPN_ID = "887";

// Διοργανώσεις που ελέγχουμε κάθε φορά (ESPN slugs)
const LEAGUES = ["gre.1", "gre.cup", "gre.greek_cup", "greece.cup", "uefa.champions"];

async function upstashGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) {
    console.error("Upstash GET error:", json.error);
    return null;
  }
  return json.result ? JSON.parse(json.result) : null;
}

async function upstashSet(key, value) {
  const res = await fetch(`${UPSTASH_URL}/set/${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: JSON.stringify(value),
  });
  const json = await res.json();
  if (json.error || json.result !== "OK") {
    console.error("Upstash SET FAILED for key", key, "->", JSON.stringify(json));
  }
  return json;
}

// Επιστρέφει true μόνο την πρώτη φορά που καλείται για το συγκεκριμένο dedupKey
// (χρησιμοποιεί SET ... NX -> ατομική "κλείδωση" ώστε ταυτόχρονα/επικαλυπτόμενα
// runs να μη στείλουν ποτέ το ίδιο γκολ δύο φορές, ό,τι κι αν συμβεί με το άλλο state)
async function claimOnce(dedupKey) {
  const res = await fetch(`${UPSTASH_URL}/set/${dedupKey}/1?NX=true&EX=21600`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) {
    console.error("Upstash claimOnce error:", json.error);
    return false;
  }
  return json.result === "OK"; // OK = το πήραμε πρώτοι εμείς· null = το είχε ήδη πάρει άλλο run
}

async function sendGoalPush(title, body) {
  await fetch("https://superb-pie-79e20a.netlify.app/.netlify/functions/push-goal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
}

async function checkLeague(leagueSlug) {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/scoreboard`
  );
  if (!res.ok) {
    console.log(`Λίγκα ${leagueSlug}: HTTP ${res.status}, παραλείπεται.`);
    return;
  }
  const data = await res.json();
  const events = data.events || [];
  const aekEvent = events.find((ev) =>
    ev.competitions[0].competitors.some((c) => c.team.id === AEK_ESPN_ID)
  );

  if (!aekEvent) return; // Δεν παίζει η ΑΕΚ σε αυτή τη διοργάνωση σήμερα

  const competition = aekEvent.competitions[0];
  const state = competition.status.type.state; // "pre" | "in" | "post"

  console.log(`[${leagueSlug}] Βρέθηκε αγώνας ΑΕΚ, status: ${state}`);

  if (state !== "in") return;

  const aekCompetitor = competition.competitors.find((c) => c.team.id === AEK_ESPN_ID);
  const opponent = competition.competitors.find((c) => c.team.id !== AEK_ESPN_ID);
  const aekGoals = Number(aekCompetitor.score);

  const stateKey = `aek-goal-state-${aekEvent.id}`;
  const prevState = (await upstashGet(stateKey)) || { aekGoals: 0 };

  console.log(`[${leagueSlug}] Τρέχον σκορ ΑΕΚ: ${aekGoals}, προηγούμενο γνωστό: ${prevState.aekGoals}`);

  if (aekGoals > prevState.aekGoals) {
    // Στέλνουμε ένα push ΑΝΑ νέο γκολ (καλύπτει και την περίπτωση 2 γκολ μεταξύ 2 ελέγχων)
    for (let g = prevState.aekGoals + 1; g <= aekGoals; g++) {
      const dedupKey = `aek-goal-sent-${aekEvent.id}-${g}`;
      const claimed = await claimOnce(dedupKey);
      if (!claimed) {
        console.log(`[${leagueSlug}] Το γκολ #${g} είχε ήδη σταλεί από άλλο run, παραλείπεται.`);
        continue;
      }
      const scoreLine = `${aekCompetitor.score}-${opponent.score}`;
      const clock = competition.status.displayClock;
      const opponentName = opponent.team.shortDisplayName || opponent.team.displayName;
      await sendGoalPush("ΓΚΟΛ ΑΕΚ! ⚽🟡⚫", `ΑΕΚ ${scoreLine} ${opponentName} (${clock})`);
      console.log(`[${leagueSlug}] Goal push sent for goal #${g}:`, scoreLine);
    }
  }

  await upstashSet(stateKey, { aekGoals });
}

const handler = async () => {
  for (const league of LEAGUES) {
    try {
      await checkLeague(league);
    } catch (err) {
      console.error(`Σφάλμα στη λίγκα ${league}:`, err.message);
    }
  }
  return { statusCode: 200 };
};

module.exports.handler = schedule("*/2 * * * *", handler);
