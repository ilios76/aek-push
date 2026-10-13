// ΠΡΟΣΩΡΙΝΟ function για διάγνωση — σβήσ' το μετά το τεστ.
// Δοκιμάζει το Upstash με τα ίδια environment variables που χρησιμοποιεί το goal-check.
// Δεν εμφανίζει ποτέ το token ή το URL.

exports.handler = async () => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const out = { hasUrl: Boolean(url), hasToken: Boolean(token) };

  async function command(args) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    return { status: res.status, body: await res.json() };
  }

  try {
    const key = "aek-test-" + Date.now();

    // 1) Το "κλείδωμα" που χρησιμοποιεί το goal-check: η 1η φορά πρέπει να δώσει OK, η 2η null
    out.claimFirst = await command(["SET", key, "1", "NX", "EX", 60]);
    out.claimSecond = await command(["SET", key, "1", "NX", "EX", 60]);

    // 2) Η εγγραφή/ανάγνωση "state" όπως τη κάνει το goal-check
    const stateKey = key + "-state";
    const write = await fetch(`${url}/set/${stateKey}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ aekGoals: 1 }),
    });
    out.stateWrite = { status: write.status, body: await write.json() };

    const read = await fetch(`${url}/get/${stateKey}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    out.stateRead = { status: read.status, body: await read.json() };
  } catch (err) {
    out.error = err.message;
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(out, null, 2),
  };
};
