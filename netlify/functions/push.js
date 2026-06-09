const fetch = require("node-fetch");
const Parser = require("rss-parser");
const parser = new Parser();
const crypto = require("crypto");

exports.handler = async () => {
  try {
    // 1. Load service account
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);

    // 2. Load Google News RSS feed
  const feed = await parser.parseURL(
  "https://news.google.com/rss/search?q=%CE%91%CE%95%CE%9A&hl=el&gl=GR&ceid=GR:el"
);



    if (!feed.items || feed.items.length === 0) {
      return {
        statusCode: 200,
        body: "No RSS items found"
      };
    }

    const latest = feed.items[0];
    const title = latest.title || "Νέο άρθρο για ΑΕΚ";
    const link = latest.link || "";

    // 3. Create JWT for FCM
    const jwtHeader = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const jwtClaim = {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
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

    // 4. Get access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 5. Send push notification
    const message = {
      message: {
        token: "eS3wOJDYS3mOLnwV5j3upl:APA91bEC06CyYguHXvCN_utgi-l0D5w_WoaqBtiI2BZNqONgQRGPdwpjCLiw224wP0w_1QotPsHfxunKwWI46K0MRWF3MFjBIaRTaF2OmgOJ_KZrCFLpvvs",
        notification: {
          title: "AEK Corner",
          body: title
        },
        webpush: {
          fcm_options: {
            link: link
          }
        }
      }
    };

    const fcmResponse = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(message)
      }
    );

    const result = await fcmResponse.json();

    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
