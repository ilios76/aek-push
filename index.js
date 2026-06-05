import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";

const RSS_URL =
  "https://news.google.com/rss/search?q=ΑΕΚ&hl=el&gl=GR&ceid=GR:el";

export default async () => {
  try {
    // 1) Fetch RSS
    const rssResponse = await fetch(RSS_URL);
    const rssText = await rssResponse.text();

    // 2) Parse XML
    const parser = new XMLParser();
    const rss = parser.parse(rssText);

    // 3) Πάρε το πρώτο άρθρο
    const firstItem = rss.rss.channel.item[0];

    const title = firstItem.title || "AEK Corner";
    const description = firstItem.description || "Νέο άρθρο για την ΑΕΚ!";

    // 4) Στείλε push στο Netlify function
    await fetch(
      "https://superb-pie-79e20a.netlify.app/.netlify/functions/push",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title,
          body: description,
        }),
      }
    );

    console.log("Push sent:", title);
  } catch (err) {
    console.error("RSS error:", err);
  }
};
