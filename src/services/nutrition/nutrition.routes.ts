import { verifyToken } from "../../utils/auth_token";
import nutritionApi from "./controller/nutrition.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
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
      "/api/nutrition/generateOptimalValues",
      verifyToken,
      nutritionApi.generateOptimalCaloricAmountAndNutrients
    );
    // this.app.post(
    //   "/api/nutrition/generateOptimalCalories",
    //   verifyToken,
    //   nutritionApi.generateOptimalCalories
    // );
  }

  routesConfig() {
    this.appRoutes();
  }
}

module.exports = Routes;
