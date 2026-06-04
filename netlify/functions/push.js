const { google } = require("googleapis");

exports.handler = async () => {
  try {
    const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);

    const jwtClient = new google.auth.JWT(
      serviceAccount.client_email,
      null,
      serviceAccount.private_key,
      ["https://www.googleapis.com/auth/firebase.messaging"]
    );

    await jwtClient.authorize();

    const projectId = serviceAccount.project_id;

    const message = {
      message: {
        token: "ΤΟ_FCM_DEVICE_TOKEN_ΣΟΥ",
        notification: {
          title: "AEK Corner",
          body: "Goal από FCM!"
        }
      }
    };

    const response = await google
      .firebasemessaging("v1")
      .projects.messages.send({
        parent: `projects/${projectId}`,
        auth: jwtClient,
        requestBody: message
      });

    return {
      statusCode: 200,
      body: JSON.stringify(response.data)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
