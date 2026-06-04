const fetch = require("node-fetch");

exports.handler = async () => {
  const appId = "232aeaed-673d-4076-b507-b2fc28a7c2ff";
  const apiKey = "os_v2_app_emvov3lhhvahnnihwl6crj6c75fwggnuaekeqc57pevsc5gr3lu2cjsk5wgohzm3m4kwm5lfab4s5by4bsuqdkhguomwawbkvbt7hxq";

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
