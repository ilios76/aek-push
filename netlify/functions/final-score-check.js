const { schedule } = require("@netlify/functions");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Κάθε εγγραφή: sport (ESPN sport path) + candidate league slugs να δοκιμάσουμε + ετικέτα για το push
const SPORTS_TO_CHECK = [
  { sport: "basketball", leagues: ["gre.1", "greece.1", "gre.a1", "greece.a1"], label: "Μπάσκετ" },
  // Volleyball/Handball: το ESPN πιθανότατα δεν τα καλύπτει καθόλου — αφήνονται
  // εδώ ως σχόλιο, θα τα ενεργοποιήσουμε αν βρεθεί δουλεύον slug στο μέλλον.
  // { sport: "volleyball", leagues: ["gre.1"], label: "Βόλεϊ" },
  // { sport: "handball", leagues: ["gre.1"], label: "Χάντμπολ" },
];

async function upstashGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) {
    console.error("Upstash GET error:", json.error);
    return null;
  }
  return json.result;
}

async function claimOnce(dedupKey) {
  const res = await fetch(`${UPSTASH_URL}/set/${dedupKey}/1?NX=true&EX=86400`, {
    method: "POST",
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  if (json.error) {
    console.error("Upstash claimOnce error:", json.error);
    return false;
  }
  return json.result === "OK";
}

async function sendPush(title, body) {
  await fetch("https://superb-pie-79e20a.netlify.app/.netlify/functions/push-goal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
}

async function checkSportLeague(sport, leagueSlug, label) {
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/scoreboard`
  );
  if (!res.ok) {
    console.log(`[${label}/${leagueSlug}] HTTP ${res.status}, παραλείπεται.`);
    return;
  }
  const data = await res.json();
  const events = data.events || [];
  const aekEvent = events.find((ev) =>
    ev.competitions[0].competitors.some((c) =>
      (c.team?.displayName || "").toUpperCase().includes("AEK")
    )
  );

  if (!aekEvent) {
    console.log(`[${label}/${leagueSlug}] Δεν βρέθηκε σημερινός αγώνας ΑΕΚ.`);
    return;
  }

  const competition = aekEvent.competitions[0];
  const state = competition.status.type.state; // "pre" | "in" | "post"

  console.log(`[${label}/${leagueSlug}] Βρέθηκε αγώνας ΑΕΚ, status: ${state}`);

  if (state !== "post") return; // Θέλουμε ΜΟΝΟ το τελικό σκορ

  const aekCompetitor = competition.competitors.find((c) =>
    (c.team?.displayName || "").toUpperCase().includes("AEK")
  );
  const opponent = competition.competitors.find((c) => c !== aekCompetitor);

  const dedupKey = `aek-finalscore-sent-${sport}-${aekEvent.id}`;
  const claimed = await claimOnce(dedupKey);
  if (!claimed) {
    console.log(`[${label}/${leagueSlug}] Το τελικό σκορ είχε ήδη σταλεί, παραλείπεται.`);
    return;
  }

  const scoreLine = `${aekCompetitor.score}-${opponent.score}`;
  const opponentName = opponent.team.shortDisplayName || opponent.team.displayName;

  await sendPush(
    `Τελικό: ΑΕΚ (${label}) 🟡⚫`,
    `ΑΕΚ ${scoreLine} ${opponentName}`
  );
  console.log(`[${label}/${leagueSlug}] Final score push sent:`, scoreLine);
}

const handler = async () => {
  for (const { sport, leagues, label } of SPORTS_TO_CHECK) {
    for (const league of leagues) {
      try {
        await checkSportLeague(sport, league, label);
      } catch (err) {
        console.error(`Σφάλμα σε ${label}/${league}:`, err.message);
      }
    }
  }
  return { statusCode: 200 };
};

// Κάθε 15 λεπτά — δεν χρειάζεται συχνότερο, θέλουμε μόνο το τελικό σκορ
module.exports.handler = schedule("*/15 * * * *", handler);
