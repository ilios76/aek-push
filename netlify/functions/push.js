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
        token: "eS3wOJDYS3mOLnwV5j3upl:APA91bEC06CyYguHXvCN_utgi-l0D5w_WoaqBtiI2BZNqONgQRGPdwpjCLiw224wP0w_1QotPsHfxunKwWI46K0MRWF3MFjBIaRTaF2OmgOJ_KZrCFLpvvs",
        notification: {
          title: "AEK Corner",
          body: "🔥 Goal από FCM! Δουλεύει ξανά!"
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
