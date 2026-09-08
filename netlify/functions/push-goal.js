const crypto = require("crypto");

// Αναδημιουργεί την ίδια λογική JWT/FCM του push.js, αλλά στέλνει το μήνυμα
// που του δίνουμε (title/body) αντί να τραβάει το τελευταίο άρθρο RSS.
exports.handler = async (event) => {
  try {
    const { title, body: messageBody } = JSON.parse(event.body || "{}");

    if (!title) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing title" }),
      };
    }

    // 1. Load service account (ίδιο env var με το push.js)
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);

    // 2. Create JWT for FCM
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

    // 3. Get access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 4. Send push notification — ίδιο test token με το push.js.
    // ΣΗΜΕΙΩΣΗ: όταν περάσεις σε broadcast προς όλους τους χρήστες της app
    // (μέσω FCM topic αντί για fixed token), θα χρειαστεί να αλλάξεις το
    // "token" σε "topic" και εδώ και στο push.js.
    const message = {
      message: {
        token:
          "eS3wOJDYS3mOLnwV5j3upl:APA91bEC06CyYguHXvCN_utgi-l0D5w_WoaqBtiI2BZNqONgQRGPdwpjCLiw224wP0w_1QotPsHfxunKwWI46K0MRWF3MFjBIaRTaF2OmgOJ_KZrCFLpvvs",
        notification: {
          title: title,
          body: messageBody || "",
        },
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
      statusCode: 200,
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
