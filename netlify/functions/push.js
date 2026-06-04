const fetch = require("node-fetch");

exports.handler = async () => {
  const appId = "0ab1df18-21ed-46ce-9440-b3e908b16eae";
  const apiKey = "os_v2_org_bky56gbb5vdm5fcawpuqrmlovzmrrjvexhyewqnugvhljrzvjpj5waesjgqs5nlbkk4tbhy43miscyoil5gubvij4r3qarrn5dukcfi";

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
