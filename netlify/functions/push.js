const fetch = require("node-fetch");
const Parser = require("rss-parser");
const fs = require("fs");

const parser = new Parser();
const lastFile = "/tmp/last.json";

exports.handler = async () => {
  try {
    // Load last sent article
    let last = { link: "", title: "" };
    if (fs.existsSync(lastFile)) {
      last = JSON.parse(fs.readFileSync(lastFile, "utf8"));
    }

    // Normalize titles to avoid duplicates like (video), (photos), etc.
    function normalizeTitle(t) {
      return t
        .toLowerCase()
        .replace(/\(.*?\)/g, "")      // remove (video), (photos), etc
        .replace(/&#\d+;/g, "")       // remove HTML entities
        .replace(/\s+/g, " ")         // collapse spaces
        .trim();
    }

    // Fetch your aggregated feed
    const feed = await parser.parseURL(
      "https://url-to-rss-magic.lovable.app/api/public/aggregate?title=My+Aggregated+Feed&url=https%3A%2F%2Faek24hours.gr%2F%3Ffeed%3Drss2&url=https%3A%2F%2Fmonobala.gr%2Fcategory%2Fteams%2Fsl1%2Faek%2Ffeed%2F&url=https%3A%2F%2Fwww.aek1924.gr%2Fcategory%2Fpodosfairo%2Ffeed%2F&url=https%3A%2F%2Febasket.gr%2Fcontent%2F%CE%B11%2F%CE%B1%CE%B5%CE%BA%2Ffeed&url=https%3A%2F%2Fbasketa.gr%2Fcategory%2F%CF%8C%CE%BB%CE%B1-%CF%84%CE%B1-%CE%BD%CE%AD%CE%B1%2F%CE%BF%CE%BC%CE%AC%CE%B4%CE%B5%CF%82%2F%CE%B1%CE%B5%CE%BA%2Ffeed&url=https%3A%2F%2Fenwsi.gr%2Faek%2Fhandball%2Ffeed&url=https%3A%2F%2Faek1924.gr%2Fcategory%2Ferasitexniki%2Fhandball%2Ffeed&url=https%3A%2F%2Fonsports.gr%2Fomades%2Faek%3Fformat%3Dfeed%26type%3Drss&url=https%3A%2F%2Furl-to-rss-magic.lovable.app%2Fapi%2Fpublic%2Ffeed%2FaHR0cHM6Ly93d3cuc3BvcnQtZm0uZ3IvdGFnL2Flaw.xml&url=https%3A%2F%2Furl-to-rss-magic.lovable.app%2Fapi%2Fpublic%2Ffeed%2FaHR0cHM6Ly93d3cuZ2F6emV0dGEuZ3IvdGVhbXMvYWVr.xml&url=https%3A%2F%2Furl-to-rss-magic.lovable.app%2Fapi%2Fpublic%2Ffeed%2FaHR0cHM6Ly93d3cuc2RuYS5nci90ZWFtcy9hZWsvcG9kb3NmYWlybw.xml&url=https%3A%2F%2Furl-to-rss-magic.lovable.app%2Fapi%2Fpublic%2Ffeed%2FaHR0cHM6Ly93d3cuc3BvcnQyNC5nci90YWcvYWVrLw.xml&url=https%3A%2F%2Furl-to-rss-magic.lovable.app%2Fapi%2Fpublic%2Ffeed%2FaHR0cHM6Ly93d3cua2F0aGltZXJpbmkuZ3IvdGFnL2Flay8.xml&t=" + Date.now()
    );

    if (!feed.items || feed.items.length === 0) {
      return { statusCode: 200, body: "No items in feed" };
    }

    const latest = feed.items[0];
    const latestTitleNorm = normalizeTitle(latest.title);
    const lastTitleNorm = normalizeTitle(last.title);

    // BLOCK duplicates by link OR normalized title
    if (latest.link === last.link || latestTitleNorm === lastTitleNorm) {
      return { statusCode: 200, body: "Duplicate blocked" };
    }

    // SEND PUSH
    await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID,
        included_segments: ["All"],
        headings: { en: "AEK Corner" },
        contents: { en: latest.title },
        url: latest.link
      })
    });

    // Save new last item
    fs.writeFileSync(
      lastFile,
      JSON.stringify({ link: latest.link, title: latest.title })
    );

    return { statusCode: 200, body: "Push sent" };

  } catch (err) {
    return { statusCode: 500, body: "Error: " + err.toString() };
  }
};
