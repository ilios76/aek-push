const fetch = require("node-fetch");

exports.handler = async () => {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${apiKey}`
    },
    body: JSON.stringify({
      app_id: appId,
      included_segments: ["All"],
      contents: { en: "AEK Corner: New update!" }
    })
  });

  const data = await response.json();

  return {
    statusCode: 200,
    body: JSON.stringify(data)
  };
};
