import express, { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import http from "http";
import AppConfig from "./config/app-config";
import fileUpload from "express-fileupload";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import PatientRoutes from "./services/patient/patient.routes";
import OpenAiRoutes from "./services/openAI/openai.routes";
import CaloriesRoutes from "./services/calories_tracker/calories.routes";
import NutritionRoutes from "./services/nutrition/nutrition.routes";
import FCMTokenRoutes from "./services/FCM_token/fcm_token.routes";
import ExercisesRoutes from "./services/exercises_tracker/exercises.routes";
import WeightRoutes from "./services/weight_tracker/weight.routes";
import GlucoseRoutes from "./services/glucose_tracker/glucose.routes";
import BFPRoutes from "./services/bodyFatPercentage/bfp.routes";
import BloodPressureRoutes from "./services/bp_tracker/bloodpressure.routes";
import PasswordRoutes from "./services/password/password.routes";
import UtilsRoutes from "./services/utils/utils.routes";
import BookingRoutes from "./services/bookings/bookings.routes";
import ClinicianRoutes from "./services/clinicians/clinicians.routes";
import DexcomRoutes from "./services/dexcom/dexcom.routes";
import PlanRoutes from "./services/plan/plan.routes";
import AgentRoutes from "./services/agent/agent.routes";
import MealPlanRoutes from "./services/meal_plan/meal_plan.routes";
import WorkoutRoutes from "./services/workouts/workouts.routes";
import LabsJourneyRoutes from "./services/labs_journey/labsJourney.routes";
import SeamRoutes from "./services/seam/seam.routes";
import MessagingRoutes from "./services/messaging/messaging.routes";
import "./services/agent/proactive/agent.worker";
import { scheduleAgentProactiveTick } from "./services/agent/proactive/agent.scheduler";
import "./workers/workers/notifications.worker";
import {
  scheduleBreakfastJobs,
  scheduleDinnerJobs,
  scheduleLunchJobs,
} from "./workers/jobSchedulers/nutrition.scheduler";
require("dotenv").config();

class Server {
  public app: Express;
  public http: http.Server;

  constructor() {
    this.app = express();
    this.app.use(
      helmet({
        contentSecurityPolicy: false,
      })
    );

    this.http = http.createServer(this.app);
    this.app.use((req: any, res: any, next: any) => {
      req.__dirname = __dirname;
      next();
    });
    this.app.use(
      fileUpload({
        limits: { fileSize: 50 * 1024 * 1024 },
        useTempFiles: false,
        tempFileDir: "/tmp/",
      } as any)
    );

    // Conditionally apply bodyParser.json only to non-upload routes
    // (compared lower-case: the app posts /patients/uploadLab)
    const skipBodyParserFor = ["/api/patients/uploadlab"];

    this.app.use((req, res, next) => {
      const path = req.path.toLowerCase();
      if (!skipBodyParserFor.some((p) => path.startsWith(p))) {
        bodyParser.json({ limit: "50mb" })(req, res, next);
      } else {
        next();
      }
    });

    this.app.set("view engine", "ejs");
    // this.app.use(express.static("assets"));
    this.app.set("trust proxy", 1);
    this.app.use(cookieParser());
    this.app.use(
      bodyParser.urlencoded({
        limit: "50mb",
        extended: true,
        parameterLimit: 200000,
      })
    );
  }

  appConfig() {
    new AppConfig(this.app).includeConfig();
  }

  includeRoutes() {
    new PatientRoutes(this.app).routesConfig();
    new OpenAiRoutes(this.app).routesConfig();
    new CaloriesRoutes(this.app).routesConfig();
    new NutritionRoutes(this.app).routesConfig();
    new FCMTokenRoutes(this.app).routesConfig();
    new ExercisesRoutes(this.app).routesConfig();
    new WeightRoutes(this.app).routesConfig();
    new GlucoseRoutes(this.app).routesConfig();
    new BFPRoutes(this.app).routesConfig();
    new BloodPressureRoutes(this.app).routesConfig();
    new PasswordRoutes(this.app).routesConfig();
    new UtilsRoutes(this.app).routesConfig();
    new BookingRoutes(this.app).routesConfig();
    new ClinicianRoutes(this.app).routesConfig();
    new DexcomRoutes(this.app).routesConfig();
    new PlanRoutes(this.app).routesConfig();
    new AgentRoutes(this.app).routesConfig();
    new MealPlanRoutes(this.app).routesConfig();
    new WorkoutRoutes(this.app).routesConfig();
    new LabsJourneyRoutes(this.app).routesConfig();
    new SeamRoutes(this.app).routesConfig();
    new MessagingRoutes(this.app).routesConfig();
  }

  startTheServer(callback?: (server: Server) => void) {
    this.appConfig();
    this.includeRoutes();
    if (process.env.NODE_ENV !== "development") {
      scheduleBreakfastJobs();
      scheduleLunchJobs();
      scheduleDinnerJobs();
      scheduleAgentProactiveTick();
    }

    // Railway (and most PaaS) inject PORT; NODE_SERVER_PORT covers local dev.
    const port = parseInt(
      process.env.PORT || process.env.NODE_SERVER_PORT || "5000"
    );
    // const host = process.env.NODE_SERVER_HOST || "localhost";
    const host = "0.0.0.0";

    this.http.listen(port, host, () => {
      console.log(`Server listening on http://${host}:${port}`);

      // Check if callback is provided and is a function
      if (callback && typeof callback === "function") {
        callback(this);
      }
    });
  }
}

export default Server;
