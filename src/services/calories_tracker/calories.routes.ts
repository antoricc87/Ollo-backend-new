import { verifyToken } from "../../utils/auth_token";
import caloriesApi from "./controller/calories.controller";
export default class Routes {
  app: any;

  constructor(app: any) {
    this.app = app;
  }
  appRoutes() {
    this.app.post(
      "/api/calories/fetchCaloriesTracker",
      verifyToken,
      caloriesApi.getCaloriesTracker
    );
    // this.app.post(
    //   "/api/calories/updatecalories",
    //   verifyToken,
    //   caloriesApi.updateCalories
    // );
    //---------------food related----------------//
    this.app.delete(
      "/api/nutrition/delete_food_entry",
      verifyToken,
      caloriesApi.deleteFoodEntry
    );
    this.app.post(
      "/api/nutrition/createfoodentry",
      verifyToken,
      caloriesApi.createFoodEntry
    );
    this.app.put(
      "/api/nutrition/update_food_entry_ingredients",
      verifyToken,
      caloriesApi.updateFoodEntryIngredients
    );
    this.app.post(
      "/api/nutrition/fetchfoodtrackerbyid",
      verifyToken,
      caloriesApi.fetchFoodTrackerById
    );
    this.app.post(
      "/api/nutrition/createfavfood",
      verifyToken,
      caloriesApi.createFavFood
    );

    this.app.post(
      "/api/nutrition/deletefavfood",
      verifyToken,
      caloriesApi.deleteFavFoods
    );

    this.app.post(
      "/api/nutrition/getfavfoods",
      verifyToken,
      caloriesApi.getFavFoods
    );
    this.app.post(
      "/api/nutrition/getDaysWithoutFood",
      verifyToken,
      caloriesApi.getDaysWithoutFood
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
