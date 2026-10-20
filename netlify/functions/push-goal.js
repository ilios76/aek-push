const crypto = require("crypto");

// Στέλνει ένα custom μήνυμα (title/body) μέσω FCM στο topic "aek-news".
// Είναι το ίδιο topic που χρησιμοποιεί το push.js, άρα το παίρνουν όλοι όσοι
// είναι ήδη εγγεγραμμένοι στις ειδοποιήσεις της εφαρμογής.
const TOPIC = "aek-news";

exports.handler = async (event) => {
  try {
    const { title, body: messageBody } = JSON.parse(event.body || "{}");

    if (!title) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing title" }),
      };
    }

    // 1. Service account (ίδιο env var με το push.js)
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);

    // 2. JWT για το FCM
    const jwtHeader = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const jwtClaim = {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    const base64url = (str) =>
      Buffer.from(str)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

    const encodedHeader = base64url(JSON.stringify(jwtHeader));
    const encodedClaim = base64url(JSON.stringify(jwtClaim));

    const signature = crypto
      .createSign("RSA-SHA256")
      .update(`${encodedHeader}.${encodedClaim}`)
      .sign(serviceAccount.private_key, "base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    const jwt = `${encodedHeader}.${encodedClaim}.${signature}`;

    // 3. Access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      throw new Error("Δεν δόθηκε access token: " + JSON.stringify(tokenData));
    }

    // 4. Αποστολή push
    const message = {
      message: {
        topic: TOPIC,
        notification: {
          title: title,
          body: messageBody || "",
        },
        // Τα γκολ είναι επείγοντα: υψηλή προτεραιότητα και λήξη μετά από 10 λεπτά,
        // ώστε ένα γκολ να μην φτάσει ώρες αργότερα σε κινητό που ήταν εκτός δικτύου.
        android: { priority: "HIGH", ttl: "600s" },
      },
    };

    const fcmResponse = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      }
    );

    const result = await fcmResponse.json();

    return {
      // Αν το FCM απέρριψε το μήνυμα, το επιστρέφουμε ως σφάλμα (πριν γύριζε πάντα 200)
      statusCode: fcmResponse.ok ? 200 : 502,
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
