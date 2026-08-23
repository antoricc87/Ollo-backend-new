import admin from "../config/firebaseAdmin";

export const sendMulticast = async (dataObj: any) => {
  const registrationTokens = Array.isArray(dataObj.tokens)
    ? dataObj.tokens
    : [dataObj.tokens];
  if (registrationTokens && registrationTokens.length > 0) {
    const message = {
      notification: {
        title: dataObj.title ? dataObj.title : "",
        body: dataObj.body ? dataObj.body : "",
      },
      data: {},
    };

    let resData = await admin.messaging().sendEachForMulticast({
      tokens: registrationTokens,
      notification: {
        title: dataObj.title ? dataObj.title : "",
        body: dataObj.body ? dataObj.body : "",
      },
      data: {},
    });

    const successfulTokens = [];
    const failedTokens = [];

    resData.responses.forEach((resp, idx) => {
      if (resp.success) {
        successfulTokens.push(registrationTokens[idx]);
      } else {
        failedTokens.push(registrationTokens[idx]);
      }
    });

    // console.log("Successful tokens:", successfulTokens);
    // console.log("Failed tokens:", failedTokens);
    return {
      successfulTokens,
      failedTokens,
    };
  }
  return false;
};

export const sendSingleNotification = async (dataObj: any) => {
  const registrationToken = dataObj.token;
  if (!registrationToken) return false;

  const message: admin.messaging.Message = {
    token: registrationToken,
    notification: {
      title: dataObj.title ?? "",
      body: dataObj.body ?? "",
    },
    data: dataObj.data ?? {},
  };
  try {
    const response = await admin.messaging().send(message);
    // response is the message ID string
    return { success: true, messageId: response };
  } catch (err: any) {
    console.error("Error sending single notification:", err);
    return { success: false, error: err };
  }
};
