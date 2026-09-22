const { schedule } = require("@netlify/functions");

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const AEK_ESPN_ID = "887";

// Διοργανώσεις που ελέγχουμε κάθε φορά (ESPN slugs)
const LEAGUES = ["gre.1", "uefa.champions"];

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

// Καλύπτει ΟΠΟΙΑΔΗΠΟΤΕ διοργάνωση (π.χ. Κύπελλο) που δεν καλύπτεται από τη λίστα LEAGUES.
// Αν αποτύχει (π.χ. μπλοκάρισμα), δεν επηρεάζει καθόλου τους παραπάνω ελέγχους.
async function checkSofascore() {
  try {
    const res = await fetch("https://api.sofascore.com/api/v1/sport/football/events/live", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: "https://www.sofascore.com/",
      },
    });
    if (!res.ok) {
      console.log("[sofascore] HTTP", res.status, "- παραλείπεται.");
      return;
    }
    const data = await res.json();
    const events = data.events || [];
    const aekEvent = events.find(
      (ev) =>
        (ev.homeTeam?.name || "").toUpperCase().includes("AEK") ||
        (ev.awayTeam?.name || "").toUpperCase().includes("AEK")
    );

    if (!aekEvent) {
      console.log("[sofascore] Δεν βρέθηκε live αγώνας ΑΕΚ.");
      return;
    }

    const tournamentName = aekEvent.tournament?.name || "";
    // Αν είναι διοργάνωση που ήδη καλύπτουμε μέσω ESPN, την αγνοούμε εδώ
    // ώστε να μη σταλεί το ίδιο γκολ δύο φορές από δύο διαφορετικές πηγές.
    if (/super league|champions league/i.test(tournamentName)) {
      console.log("[sofascore] Παραλείπεται, ήδη καλύπτεται από ESPN:", tournamentName);
      return;
    }

    const isHome = (aekEvent.homeTeam?.name || "").toUpperCase().includes("AEK");
    const aekGoals = isHome ? aekEvent.homeScore.current : aekEvent.awayScore.current;
    const opponentName = isHome ? aekEvent.awayTeam.name : aekEvent.homeTeam.name;

    console.log(`[sofascore] Βρέθηκε αγώνας ΑΕΚ (${tournamentName}), σκορ ΑΕΚ: ${aekGoals}`);

    const stateKey = `aek-goal-state-sofa-${aekEvent.id}`;
    const prevState = (await upstashGet(stateKey)) || { aekGoals: 0 };

    if (aekGoals > prevState.aekGoals) {
      for (let g = prevState.aekGoals + 1; g <= aekGoals; g++) {
        const dedupKey = `aek-goal-sent-sofa-${aekEvent.id}-${g}`;
        const claimed = await claimOnce(dedupKey);
        if (!claimed) continue;
        const scoreLine = isHome
          ? `${aekEvent.homeScore.current}-${aekEvent.awayScore.current}`
          : `${aekEvent.awayScore.current}-${aekEvent.homeScore.current}`;
        await sendGoalPush(
          "ΓΚΟΛ ΑΕΚ! ⚽🟡⚫",
          `ΑΕΚ ${scoreLine} ${opponentName} (${tournamentName})`
        );
        console.log(`[sofascore] Goal push sent for goal #${g}:`, scoreLine);
      }
    }

    await upstashSet(stateKey, { aekGoals });
  } catch (err) {
    console.error("[sofascore] Σφάλμα:", err.message);
  }
}

const handler = async () => {
  for (const league of LEAGUES) {
    try {
      await checkLeague(league);
    } catch (err) {
      console.error(`Σφάλμα στη λίγκα ${league}:`, err.message);
    }
  }
  await checkSofascore();
  return { statusCode: 200 };
};

module.exports.handler = schedule("*/2 * * * *", handler);
