import { Express, Request, Response } from "express";
import FitbitHandler from "./model/fitbit.model";
import FitBitApi from "./controller/fitbit.controller";
// const fitbitClientId = "23PGCD";
// const fitbitClientSecret = "b6ef75f3972b8a09aa6db038d299f5b7";
// const fitbitRedirectUri = "http://localhost:3000/fitbit";

export default class FitBitRoutes {
  app: Express;
  constructor(app: Express) {
    this.app = app;
  }

  appRoutes() {
    // Route to initiate OAuth flow
    this.app.get("/api/authorize", FitBitApi.authorizeFitBit);
    // Redirect URI route
    this.app.get("/api/callback/:token", FitBitApi.getFitBitProfile);
    this.app.get("/api/get-fitbit-profile", FitBitApi.getFitBitProfile);
  }

  routesConfig() {
    this.appRoutes();
  }
}
// mobile version
// import { Express } from "express";
// import FitBitApi from "./controller/fitbit.controller";

// export default class FitBitRoutes {
//   app: Express;
//   constructor(app: Express) {
//     this.app = app;
//   }

//   appRoutes() {
//     // Route to initiate OAuth flow
//     this.app.get("/api/authorize", FitBitApi.authorizeFitBit);
//     // Redirect URI route
//     this.app.get("/api/callback", FitBitApi.getFitBitProfile);
//   }

//   routesConfig() {
//     this.appRoutes();
//   }
// }
