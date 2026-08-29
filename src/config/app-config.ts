import express, { Express } from "express";
import bodyParser from "body-parser";
import cors from "cors";

export default class AppConfig {
  public app: Express;
  constructor(app: any) {
    process.on("unhandledRejection", (reason, p) => {
      console.log("Unhandled Rejection at: Promise", p, "reason:", reason);
    });
    this.app = app;
  }

  includeConfig() {
    this.loadAppLevelConfig();
    this.loadExpressConfig();
  }

  loadAppLevelConfig() {
    this.app.use(bodyParser.json());
    // Configure CORS
    // Browser origins only (the mobile app sends no Origin). The physician
    // portal origins were removed with the physician surface (2026-08-29).
    const allowedOrigins = ["http://localhost:3000", "https://ollo-health.com"];

    this.app.use(
      cors({
        origin: function (origin, callback) {
          if (!origin) return callback(null, true);
          if (allowedOrigins.includes(origin)) {
            return callback(null, origin);
          } else {
            const msg =
              "The CORS policy for this site does not allow access from the specified Origin.";
            return callback(new Error(msg), false);
          }
        },
        credentials: true,
        allowedHeaders: ["Authorization", "Content-Type", "x-custom-header"],
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        preflightContinue: false,
        optionsSuccessStatus: 204,
      })
    );
  }

  loadExpressConfig() {}
}
module.exports = AppConfig;
