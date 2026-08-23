import { verifyDoctorToken, verifyToken } from "../../utils/auth_token";
import nutritionApi from "./controller/nutrition.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/nutrition/generate_meals",
      verifyToken,
      nutritionApi.generateMealPlan
    );
    this.app.post(
      "/api/nutrition/portion_calculator",
      verifyToken,
      nutritionApi.generatePortions
    );
    this.app.get(
      "/api/nutrition/get_nutrients_tracker",
      verifyToken,
      nutritionApi.fetchNutrientsTracker
    );
    this.app.get(
      "/api/nutrition/get_nutrients_tracker_doctor",
      verifyDoctorToken,
      nutritionApi.fetchNutrientsTracker
    );
    this.app.get(
        "/api/nutrition/get_weekly_nutrients_in_range",
        verifyToken,
        nutritionApi.fetchWeeklyNutrientsInRange
      );
    this.app.delete(
      "/api/nutrition/delete_nutrients_tracker",
      verifyToken,
      nutritionApi.deleteNutriensTracker
    );
    this.app.post(
      "/api/nutrition/createFavMeal",
      verifyToken,
      nutritionApi.createFavMeal
    );
    this.app.post(
      "/api/nutrition/deleteFavMeal",
      verifyToken,
      nutritionApi.deleteFavMeal
    );
    this.app.get(
      "/api/nutrition/fetchFavMeals",
      verifyToken,
      nutritionApi.fetchFavMeals
    );
    this.app.post(
      "/api/nutrition/addGeneratedNutritionValues",
      verifyToken,
      nutritionApi.addGeneratedNutrientsAndCalories
    );
    this.app.post(
      "/api/nutrition/generateOptimalValues",
      verifyToken,
      nutritionApi.generateOptimalCaloricAmountAndNutrients
    );
    // this.app.post(
    //   "/api/nutrition/generateOptimalCalories",
    //   verifyToken,
    //   nutritionApi.generateOptimalCalories
    // );
    this.app.post(
      "/api/nutrition/saveMealPlan",
      verifyToken,
      nutritionApi.generateAndSaveMealPlan
    );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
