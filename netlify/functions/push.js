const fetch = require("node-fetch");

exports.handler = async () => {
  const appId = "ΤΟ_APP_ID_ΣΟΥ";
  const apiKey = "ΤΟ_REST_API_KEY_ΣΟΥ";

  return {
    statusCode: 200,
    body: JSON.stringify({
      debug: {
        appId,
        apiKeyStartsWith: apiKey.substring(0, 10),
        apiKeyLength: apiKey.length
      }
    })
  };
};
