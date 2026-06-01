const admin = require("firebase-admin");
const Parser = require("rss-parser");
const parser = new Parser();

const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const DEVICE_TOKEN = process.env.DEVICE_TOKEN;

async function sendPush() {
  try {
    const feed = await parser.parseURL(
      "https://news.google.com/rss/search?q=AEK&hl=el&gl=GR&ceid=GR:el"
    );
    const latest = feed.items[0];

    const message = {
      token: DEVICE_TOKEN,
      notification: {
        title: "AEK Corner",
        body: latest.title
      }
    };

    const response = await admin.messaging().send(message);
    console.log("Push sent:", response);
  } catch (error) {
    console.error("Error sending push:", error);
  }
}

sendPush();