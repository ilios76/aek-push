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
  // Ολόκληρη η εντολή σαν JSON array στο body (ο τεκμηριωμένος τρόπος του Upstash REST)
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", dedupKey, "1", "NX", "EX", 900]), // 15 λεπτά
  });
  const json = await res.json();
  if (json.error) {
    console.error("Upstash claimOnce ERROR:", json.error);
    return false;
  }
  console.log("claimOnce", dedupKey, "->", json.result);
  return json.result === "OK"; // OK = το πήραμε πρώτοι εμείς· null = το είχε ήδη πάρει άλλο run
}

// Επιστρέφει true ΜΟΝΟ αν το push-goal (και το FCM) δέχτηκε το μήνυμα
async function sendGoalPush(title, body) {
  try {
    const res = await fetch("https://superb-pie-79e20a.netlify.app/.netlify/functions/push-goal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    const text = await res.text();
    console.log("push-goal response:", res.status, text.slice(0, 300));
    return res.ok;
  } catch (err) {
    console.error("push-goal request failed:", err.message);
    return false;
  }
}

// Ελευθερώνει το "κλείδωμα" ενός γκολ, ώστε να ξαναδοκιμαστεί η αποστολή
async function releaseClaim(dedupKey) {
  try {
    await fetch(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["DEL", dedupKey]),
    });
  } catch (err) {
    console.error("releaseClaim error:", err.message);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clockSeconds(play) {
  const value = play && play.clock ? Number(play.clock.value) : NaN;
  return Number.isFinite(value) ? value : 0;
}

// Τα γκολ του αγώνα (ESPN "details") για την ΑΕΚ ή τον αντίπαλο, με σειρά χρόνου.
// Υποθέτουμε ότι στα αυτογκόλ το ESPN δίνει την ομάδα του παίκτη που το έβαλε.
// Αν δεν ισχύει, απλά δεν θα βρεθεί σκόρερ και το μήνυμα θα φύγει χωρίς όνομα.
function scoringPlaysFor(competition, side) {
  const details = Array.isArray(competition && competition.details) ? competition.details : [];
  return details
    .filter((d) => d && d.scoringPlay && !d.shootout && d.team && d.team.id != null)
    .filter((d) => {
      const isAekPlayer = String(d.team.id) === AEK_ESPN_ID;
      const creditedToAek = d.ownGoal ? !isAekPlayer : isAekPlayer;
      return side === "ΑΕΚ" ? creditedToAek : !creditedToAek;
    })
    .sort((a, b) => clockSeconds(a) - clockSeconds(b));
}

function describeScorer(play) {
  if (!play) return null;
  const athlete = Array.isArray(play.athletesInvolved) ? play.athletesInvolved[0] : null;
  const name = athlete && (athlete.displayName || athlete.fullName || athlete.shortName);
  if (!name) return null;
  const tag = play.ownGoal ? " (αυτογκόλ)" : play.penaltyKick ? " (πέναλτι)" : "";
  return {
    name: name + tag,
    minute: play.clock && play.clock.displayValue ? play.clock.displayValue : null,
  };
}

// Ξαναδιαβάζει τον αγώνα (αν το όνομα του σκόρερ δεν έχει εμφανιστεί ακόμα στο ESPN)
async function fetchCompetition(leagueSlug, eventId) {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/scoreboard`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const ev = (data.events || []).find((e) => String(e.id) === String(eventId));
    return ev ? ev.competitions[0] : null;
  } catch (err) {
    return null;
  }
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
  const oppGoals = Number(opponent.score);

  if (!Number.isFinite(aekGoals) || !Number.isFinite(oppGoals)) {
    console.log(`[${leagueSlug}] Το σκορ δεν είναι διαθέσιμο ακόμα, παραλείπεται.`);
    return;
  }

  const stateKey = `aek-goal-state-${aekEvent.id}`;
  const saved = await upstashGet(stateKey);
  // Πρώτο run του αγώνα: ξεκινάμε από 0-0. Αν υπάρχει state χωρίς "oppGoals"
  // (π.χ. έγινε deploy στη μέση αγώνα), παίρνουμε ως αφετηρία το τρέχον σκορ του
  // αντιπάλου, ώστε να μη σταλούν ξαφνικά ειδοποιήσεις για γκολ που έχουν ήδη πέσει.
  const prevState = {
    aekGoals: saved && Number.isFinite(saved.aekGoals) ? saved.aekGoals : 0,
    oppGoals: saved ? (Number.isFinite(saved.oppGoals) ? saved.oppGoals : oppGoals) : 0,
  };

  console.log(
    `[${leagueSlug}] Σκορ ΑΕΚ-αντίπαλος: ${aekGoals}-${oppGoals}, προηγούμενο γνωστό: ${prevState.aekGoals}-${prevState.oppGoals}`
  );

  const clock = competition.status.displayClock;
  const opponentName = opponent.team.shortDisplayName || opponent.team.displayName;
  const scoreLine = `${aekGoals}-${oppGoals}`;

  const sides = [
    {
      kind: "ΑΕΚ",
      current: aekGoals,
      previous: prevState.aekGoals,
      keyPrefix: "aek-goal-sent",
      title: "ΓΚΟΛ ΑΕΚ! ⚽🟡⚫",
    },
    {
      kind: "αντίπαλος",
      current: oppGoals,
      previous: prevState.oppGoals,
      keyPrefix: "aek-conceded-sent",
      title: "Γκολ αντιπάλου 😕",
    },
  ];

  // Αν υπάρχει νέο γκολ αλλά το ESPN δεν έχει βάλει ακόμα τον σκόρερ, περιμένουμε
  // λίγο και ξαναδιαβάζουμε (μία φορά ανά run) πριν στείλουμε.
  let comp = competition;
  const missingScorers = () =>
    sides.some(
      (side) => side.current > side.previous && scoringPlaysFor(comp, side.kind).length < side.current
    );
  if (missingScorers()) {
    await sleep(5000);
    const fresh = await fetchCompetition(leagueSlug, aekEvent.id);
    if (fresh) comp = fresh;
  }

  for (const side of sides) {
    const plays = scoringPlaysFor(comp, side.kind);
    // Ένα push ΑΝΑ νέο γκολ (καλύπτει και την περίπτωση 2 γκολ μεταξύ 2 ελέγχων)
    for (let g = side.previous + 1; g <= side.current; g++) {
      const dedupKey = `${side.keyPrefix}-${aekEvent.id}-${g}`;
      const claimed = await claimOnce(dedupKey);
      if (!claimed) {
        console.log(`[${leagueSlug}] Το γκολ #${g} (${side.kind}) είχε ήδη σταλεί, παραλείπεται.`);
        continue;
      }

      const scorer = describeScorer(plays[g - 1]);
      console.log(
        `[${leagueSlug}] Σκόρερ για γκολ #${g} (${side.kind}):`,
        scorer ? scorer.name : "δεν βρέθηκε",
        `(γκολ στο ESPN: ${plays.length}/${side.current})`
      );
      const message = scorer
        ? `${scorer.name} (${scorer.minute || clock}) · ΑΕΚ ${scoreLine} ${opponentName}`
        : `ΑΕΚ ${scoreLine} ${opponentName} (${clock})`;

      const ok = await sendGoalPush(side.title, message);
      if (!ok) {
        // Δεν στάλθηκε: ελευθερώνουμε το κλείδωμα και ΔΕΝ ενημερώνουμε το state,
        // ώστε το επόμενο run (σε 2 λεπτά) να ξαναδοκιμάσει το ίδιο γκολ.
        console.error(`[${leagueSlug}] Push FAILED για γκολ #${g} (${side.kind}) — θα ξαναδοκιμάσει στο επόμενο run.`);
        await releaseClaim(dedupKey);
        return;
      }
      console.log(`[${leagueSlug}] Push sent για γκολ #${g} (${side.kind}):`, scoreLine);
    }
  }

  await upstashSet(stateKey, { aekGoals, oppGoals });
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
