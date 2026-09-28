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
    // Saved-meals screen: identity from the token only; ids are checked against it.
    this.app.get("/api/nutrition/favorites", verifyToken, nutritionApi.listFavorites);
    this.app.post("/api/nutrition/favorites", verifyToken, nutritionApi.saveFavoriteFromEntry);
    this.app.put("/api/nutrition/favorites/:favoriteId", verifyToken, nutritionApi.updateFavorite);
    this.app.delete("/api/nutrition/favorites/:favoriteId", verifyToken, nutritionApi.removeFavorite);
    this.app.post("/api/nutrition/favorites/:favoriteId/log", verifyToken, nutritionApi.logFavorite);
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
