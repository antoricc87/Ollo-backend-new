// import FitbitHandler from "../model/fitbit.model";
// import { Express, Request, Response } from "express";
// import dotenv from "dotenv";
// dotenv.config();

// const fitbitClientId = process.env.FITBIT_CLIENT_ID || "";
// const fitbitClientSecret = process.env.FITBIT_CLIENT_SECRET || "";
// const fitbitRedirectUri = process.env.FITBIT_REDIRECT_URL || "";
// const fitbitApi = new FitbitHandler(
//   fitbitClientId,
//   fitbitClientSecret,
//   fitbitRedirectUri
// );

// let codeVerifier: string;

// class FitBitApi {
//   //get fitbit authorization
//   async authorizeFitBit(req: Request, res: Response) {
//     codeVerifier = fitbitApi.generateRandomString(128);
//     const codeChallenge = await fitbitApi.generateCodeChallenge(codeVerifier);
//     const authorizationUrl = fitbitApi.getAuthorizationUrl(codeChallenge);
//     res.redirect(authorizationUrl);
//   }

//   //redirect uri route
//   async getFitBitProfile(req: Request, res: Response) {
//     // const authorizationCode = req.params.token;
//     const authorizationCode = req.query.code as string;
//     if (!authorizationCode) {
//       return res.status(400).json({ error: "Authorization code is missing" });
//     }

//     const tokenResponse = await fitbitApi.exchangeCodeForToken(
//       authorizationCode,
//       codeVerifier
//     );

//     if (tokenResponse.error) {
//       return res.status(400).json(tokenResponse);
//     }

//     const userProfile = await fitbitApi.getUserProfile(
//       tokenResponse.access_token
//     );

//     if (userProfile.errors) {
//       return res.status(401).json(userProfile);
//     }

//     const heartRateData = await fitbitApi.getHeartRate(
//       tokenResponse.access_token
//     );
//     const weightData = await fitbitApi.getWeight(tokenResponse.access_token);
//     const sleepData = await fitbitApi.getSleep(tokenResponse.access_token);
//     const breathingData = await fitbitApi.getBreathing(
//       tokenResponse.access_token
//     );
//     const hrvData = await fitbitApi.getHeartRateVariability(
//       tokenResponse.access_token
//     );
//     const cardioScore = await fitbitApi.getCardioScore(
//       tokenResponse.access_token
//     );
//     res.json({
//       userProfile,
//       heartRateData,
//       weightData,
//       sleepData,
//       breathingData,
//       heartRateVariability: hrvData,
//       cardioScore,
//     });
//   }
// }

// export default new FitBitApi();
// mobile version
import FitbitHandler from "../model/fitbit.model";
import { Request, Response } from "express";
import dotenv from "dotenv";
dotenv.config();

const fitbitClientId = process.env.FITBIT_CLIENT_ID || "";
const fitbitClientSecret = process.env.FITBIT_CLIENT_SECRET || "";
const fitbitRedirectUri = process.env.FITBIT_REDIRECT_URL || "";
const fitbitApi = new FitbitHandler(
  fitbitClientId,
  fitbitClientSecret,
  fitbitRedirectUri
);

class FitBitApi {
  private codeVerifier: string;

  constructor() {
    this.codeVerifier = ""; // Initialize the codeVerifier
  }

  // Initiate Fitbit authorization
  authorizeFitBit = async (req: Request, res: Response) => {
    this.codeVerifier = fitbitApi.generateRandomString(128); // Set the codeVerifier
    const codeChallenge = await fitbitApi.generateCodeChallenge(
      this.codeVerifier
    );
    const authorizationUrl = fitbitApi.getAuthorizationUrl(codeChallenge);
    console.log(authorizationUrl);
    res.redirect(authorizationUrl);
  };

  // Handle callback from Fitbit and fetch user profile
  getFitBitProfile = async (req: Request, res: Response) => {
    console.log("getFitBitProfile");
    const authorizationCode = req.query.code as string;
    if (!authorizationCode) {
      return res.status(400).json({ error: "Authorization code is missing" });
    }

    const tokenResponse = await fitbitApi.exchangeCodeForToken(
      authorizationCode,
      this.codeVerifier
    );

    if (tokenResponse.error) {
      return res.status(400).json(tokenResponse);
    }

    const userProfile = await fitbitApi.getUserProfile(
      tokenResponse.access_token
    );

    if (userProfile.errors) {
      return res.status(401).json(userProfile);
    }

    const heartRateData = await fitbitApi.getHeartRate(
      tokenResponse.access_token
    );
    const weightData = await fitbitApi.getWeight(tokenResponse.access_token);
    const sleepData = await fitbitApi.getSleep(tokenResponse.access_token);
    const breathingData = await fitbitApi.getBreathing(
      tokenResponse.access_token
    );
    const hrvData = await fitbitApi.getHeartRateVariability(
      tokenResponse.access_token
    );
    const cardioScore = await fitbitApi.getCardioScore(
      tokenResponse.access_token
    );

    res.json({
      userProfile,
      heartRateData,
      weightData,
      sleepData,
      breathingData,
      heartRateVariability: hrvData,
      cardioScore,
    });
  };
}

export default new FitBitApi();
