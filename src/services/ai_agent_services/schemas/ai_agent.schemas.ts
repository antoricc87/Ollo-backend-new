import { z } from "zod";

// Meal Plan Schema
export const mealPlanSchema = z.object({
  days: z.array(
    z.object({
      day: z.string(),
      meals: z.object({
        breakfast: z.object({
          meal_description: z.string(),
          ingredients: z.array(z.string()),
          calories: z.number(),
          nutrients: z.object({
            carbohydrates: z.number(),
            proteins: z.number(),
            fats: z.number(),
            fiber: z.number(),
            sodium: z.number(),
            naturalSugar: z.number(),
            addedSugar: z.number(),
            calcium: z.number(),
            magnesium: z.number(),
            iron: z.number(),
            potassium: z.number(),
            omega_3: z.number(),
            cholesterol: z.number(),
            zinc: z.number(),
            vitaminD: z.number(),
            vitaminB12: z.number(),
            vitaminC: z.number(),
            vitaminE: z.number(),
          }),
        }),
        lunch: z.object({
          meal_description: z.string(),
          ingredients: z.array(z.string()),
          calories: z.number(),
          nutrients: z.object({
            carbohydrates: z.number(),
            proteins: z.number(),
            fats: z.number(),
            fiber: z.number(),
            sodium: z.number(),
            naturalSugar: z.number(),
            addedSugar: z.number(),
            calcium: z.number(),
            magnesium: z.number(),
            iron: z.number(),
            potassium: z.number(),
            omega_3: z.number(),
            cholesterol: z.number(),
            zinc: z.number(),
            vitaminD: z.number(),
            vitaminB12: z.number(),
            vitaminC: z.number(),
            vitaminE: z.number(),
          }),
        }),
        snack: z.object({
          meal_description: z.string(),
          ingredients: z.array(z.string()),
          calories: z.number(),
          nutrients: z.object({
            carbohydrates: z.number(),
            proteins: z.number(),
            fats: z.number(),
            fiber: z.number(),
            sodium: z.number(),
            naturalSugar: z.number(),
            addedSugar: z.number(),
            calcium: z.number(),
            magnesium: z.number(),
            iron: z.number(),
            potassium: z.number(),
            omega_3: z.number(),
            cholesterol: z.number(),
            zinc: z.number(),
            vitaminD: z.number(),
            vitaminB12: z.number(),
            vitaminC: z.number(),
            vitaminE: z.number(),
          }),
        }),
        dinner: z.object({
          meal_description: z.string(),
          ingredients: z.array(z.string()),
          calories: z.number(),
          nutrients: z.object({
            carbohydrates: z.number(),
            proteins: z.number(),
            fats: z.number(),
            fiber: z.number(),
            sodium: z.number(),
            naturalSugar: z.number(),
            addedSugar: z.number(),
            calcium: z.number(),
            magnesium: z.number(),
            iron: z.number(),
            potassium: z.number(),
            omega_3: z.number(),
            cholesterol: z.number(),
            zinc: z.number(),
            vitaminD: z.number(),
            vitaminB12: z.number(),
            vitaminC: z.number(),
            vitaminE: z.number(),
          }),
        }),
      }),
    })
  ),
  totalCalories: z.number(),
  dietType: z.string(),
  plan_description: z.string(),
});

export const portionResponseSchema = z.array(
  z.object({
    name: z.string(),
    amount: z.string(),
    calories: z.string(),
    nutrients: z.object({
      carbohydrates: z.string(),
      proteins: z.string(),
      fats: z.string(),
      fiber: z.string(),
      sodium: z.string(),
      naturalSugar: z.string(),
      addedSugar: z.string(),
      calcium: z.string(),
      magnesium: z.string(),
      iron: z.string(),
      potassium: z.string(),
      omega_3: z.string(),
      cholesterol: z.string(),
      zinc: z.string(),
      vitaminD: z.string(),
      vitaminB12: z.string(),
      vitaminC: z.string(),
      vitaminE: z.string(),
    }),
  })
);

export const mealPlanStructureString = `
{
  "days": [
    {
      "day": "Day 1",
      "meals": {
        "breakfast": {
          "meal_description": "Example breakfast description", // Description of the breakfast
          "ingredients": ["ingredient1", "ingredient2"], // List of ingredients
          "calories": 300 // Total calories
        },
        "lunch": {
          // ... similar structure for lunch ...
        },
        "snack": {
          // ... similar structure for snack ...
        },
        "dinner": {
          // ... similar structure for dinner ...
        }
      }
    }
  ],
  "plan_description": "Dairy free 4-Days Meal Plan" // from user query:create a meal plan for 4 days and gluten free  
}
`;

export const recipeStructureString = `[{
  "title": "Carbonara Recipe", // Name of the recipe
  "ai_considerations": "Here's a Carbonara recipe for you! However, please note that traditional Carbonara contains eggs, and since you have a severe allergy to eggs, I recommend avoiding this recipe or finding an egg-free alternative.", // AI-generated considerations
  "ingredients": [
    "ingredient 1",
    "ingredient 2",// all the rest of the ingredients
  ],
  "instructions": [
    "Boil a large pot of salted water and cook the spaghetti according to package instructions until al dente. Reserve 1 cup of pasta water, then drain the pasta."// first step,
    "Second Step",
    "Third Step",// all the rest of the steps
  ],
  "videos": [
    {
      "title": "Espaguetis a la carbonara",
      "url": "https://www.youtube.com/watch?v=BPywPrshluY",
      "thumbnail": "https://i.ytimg.com/vi/BPywPrshluY/default.jpg"
    },
    {
      "title": "PINOY-STYLE CARBONARA 3 WAYS WITH MS. ERIN & MS. THERESA",
      "url": "https://www.youtube.com/watch?v=4RNi_e8AdAU",
      "thumbnail": "https://i.ytimg.com/vi/4RNi_e8AdAU/default.jpg"
    },
  ]
},]`;

export const workoutStructureString = `{
  "title": "Full Body Strength Training", // Name of the workout plan
  "ai_considerations": "This workout plan is designed for strength building while considering joint health and injury prevention. Ensure proper warm-up and cool-down routines.", // AI-generated considerations
  "goal": "Strength & Muscle Gain", // Could be: Fat Loss, Endurance, Mobility, etc.
  "duration": "45 minutes", // Total workout duration
  "exercises": [
    {
      "name": "Squats",
      "description": "Perform squats with proper form, keeping your back straight and knees aligned.",
      "sets": "3",
      "reps": "12",
      "rest_time": "30 seconds",
    }, 
    {other exercise..}
  ],
  "cool_down": [
    {
      "name": "Hamstring Stretch",
      "duration": "30 seconds each leg",
    },
    {other cool down...}
  ],
  "videos": [
    {
      "title": "45 min Full Body Strngth",
      "url": "https://www.youtube.com/watch?v=BPywPrshluY",
      "thumbnail": "https://i.ytimg.com/vi/BPywPrshluY/default.jpg"
    },
  {more videos...}
  ]
}`;

export const singleMealStructureString = `
{
   "meals": [
      {
          "meal_type": "Breakfast",
          "meal_description": "A healthy start to the day with oatmeal and berries.",
          "ingredients": ["Oats (1cup)", "Almond milk(1cup)", "Blueberries(50g)", "Honey(1tbsp)"],
          "calories": 300
      },
      {another meal}
   ],
   "instacartMessage": "That meal sounds delicious! Would you like me to create a shoppable Instacart link so you can easily grab the ingredients? 🛒😃"
}
`;
