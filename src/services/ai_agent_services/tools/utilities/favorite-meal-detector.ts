import { ChatOpenAI } from "@langchain/openai";
import NutritionService from "../../../nutrition/model/nutrition.model";

/**
 * LLM-based favorite meal detection for meal logging queries
 * This uses an LLM to intelligently detect favorite meal references
 */
export class FavoriteMealDetector {
  private llm: any;

  constructor() {
    this.llm = new ChatOpenAI({
      openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.1,
    });
  }

  /**
   * Detects favorite meal references in user queries using LLM
   * @param userQuery - The user's query text
   * @param patientId - The ID of the patient
   * @returns Object with detected favorite meal info and cleaned query
   */
  async detectFavoriteMealInQuery(
    userQuery: string,
    patientId: string
  ): Promise<{
    targetFavMeal: any | null;
    favMealName: string | null;
    cleanedQuery: string;
    isFavoriteMealQuery: boolean;
    confidence: number;
    dateReference: string | null;
    dateConfidence: number;
  }> {
    try {
      // Get all favorite meals for the patient
      const favMeals = await NutritionService.getFavMeals({
        where: { userId: patientId },
        // Phase 3: ingredient rows ride along so a re-logged favorite keeps its breakdown
        include: { ingredients: { include: { ingredients: { orderBy: { sortOrder: "asc" as const } } } } },
      });

      if (!favMeals || favMeals.length === 0) {
        return {
          targetFavMeal: null,
          favMealName: null,
          cleanedQuery: userQuery,
          isFavoriteMealQuery: false,
          confidence: 0,
          dateReference: null,
          dateConfidence: 0,
        };
      }

      // Create a list of favorite meal names for the LLM
      const favMealNames = favMeals.map((meal) => ({
        id: meal.id,
        description: meal.description,
        mealType: meal.mealType,
      }));

      // Create the prompt for the LLM
      const prompt = this.createDetectionPrompt(userQuery, favMealNames);

      // Call the LLM
      const response = await this.llm.invoke(prompt);
      const result = this.parseLLMResponse(response.content as string);

      // If a favorite meal was detected, find the matching meal and use LLM-generated cleaned query
      let targetFavMeal = null;
      let cleanedQuery = userQuery;
      console.log("result", response.content);
      if (result.isFavoriteMealQuery && result.favMealName) {
        // Find the actual favorite meal object
        targetFavMeal = favMeals.find(
          (meal) =>
            meal.description
              .toLowerCase()
              .includes(result.favMealName.toLowerCase()) ||
            result.favMealName
              .toLowerCase()
              .includes(meal.description.toLowerCase())
        );

        if (targetFavMeal && result.cleanedQuery) {
          // Use the LLM-generated cleaned query
          cleanedQuery = result.cleanedQuery;
        }
      }

      return {
        targetFavMeal,
        favMealName: result.favMealName,
        cleanedQuery,
        isFavoriteMealQuery: result.isFavoriteMealQuery,
        confidence: result.confidence,
        dateReference: result.dateReference || null,
        dateConfidence: result.dateConfidence || 0,
      };
    } catch (error) {
      console.error("Error in FavoriteMealDetector:", error);
      return {
        targetFavMeal: null,
        favMealName: null,
        cleanedQuery: userQuery,
        isFavoriteMealQuery: false,
        confidence: 0,
        dateReference: null,
        dateConfidence: 0,
      };
    }
  }

  private createDetectionPrompt(userQuery: string, favMeals: any[]): string {
    const favMealList = favMeals
      .map(
        (meal, index) =>
          `${index + 1}. "${meal.description}" (${
            meal.mealType
          }) - Ingredients: ${meal.ingredients}`
      )
      .join("\n");

    return `Analyze this user query and determine if they're referencing a favorite meal from their saved favorites.

**User Query:** "${userQuery}"

**Available Favorite Meals:**
${favMealList}

**Favorite meal indicators include:**
- Direct references: "my favorite breakfast", "log my favorite lunch", "my usual dinner"
- Vague descriptions that match saved meals: "the yogurt breakfast", "that chicken meal", "my go-to lunch"
- Meal type + ingredient combinations that match saved meals
- References to previously saved meals without full descriptions

        **Instructions:**
        1. **CRITICAL**: Look for ALL favorite meal references in the query, not just one
        2. Identify EVERY favorite meal reference (look for "my favorite", "favorite breakfast/lunch/dinner", "my usual", "go-to", etc.)
        3. For each favorite meal reference, determine which saved favorite it matches
        4. Consider partial matches, ingredient mentions, and meal type context
        5. Be generous with matching - users often describe saved meals vaguely
        6. **CRITICAL DATE EXTRACTION**: ALWAYS look for date/time references in the query. Common patterns:
           - "yesterday I had...", "today I ate...", "tomorrow I will have..."
           - "Monday I had...", "Tuesday I ate...", "last Friday I had..."
           - "2 days ago I had...", "last week I ate...", "this morning I had..."
           - Specific dates like "12/25/2023 I had...", "on January 15th I ate..."
        7. **MULTIPLE FAVORITES**: If you find multiple favorite meal references, identify the FIRST one that matches a saved favorite
        8. CRITICAL: For cleanedQuery, you MUST remove the COMPLETE favorite meal reference and keep ONLY the remaining meal descriptions
        9. **DATE PRESERVATION**: If the original query contains date/time references (yesterday, today, Monday, etc.), you MUST preserve them in the cleaned query for the remaining meals

**CLEANING RULES:**
- Remove the ENTIRE phrase that refers to the favorite meal
- Keep only the parts that describe OTHER meals (not the favorite meal)
- **CRITICAL: PRESERVE DATE CONTEXT** - If the original query has date references, keep them in the cleaned query
- If the query ONLY mentions the favorite meal, return empty string ""
- Be very precise - don't leave any part of the favorite meal reference

**Examples:**
- Input: "Log my favorite breakfast and for lunch I had chicken salad"
- cleanedQuery: "for lunch I had chicken salad"
- Input: "I had my usual lunch and for dinner pasta with meatballs"  
- cleanedQuery: "for dinner pasta with meatballs"
- Input: "Can you log my favorite breakfast?"
- cleanedQuery: ""
- Input: "Log my favorite breakfast and for lunch pasta with meatballs"
- cleanedQuery: "for lunch pasta with meatballs"
- Input: "Yesterday I had my favorite breakfast and for lunch I had chicken Caesar salad"
- cleanedQuery: "Yesterday for lunch I had chicken Caesar salad"
- Input: "Monday I had my favorite lunch and for dinner pasta with meatballs"
- cleanedQuery: "Monday for dinner pasta with meatballs"
- Input: "2 days ago I had my go-to breakfast and for lunch I had salmon"
- cleanedQuery: "2 days ago for lunch I had salmon"
- Input: "Yesterday I had my favorite breakfast and for lunch pasta bolognese"
- cleanedQuery: "Yesterday for lunch pasta bolognese"
- Input: "yesterday I had my favorite breakfast and for lunch chicken Caesar salad"
- cleanedQuery: "yesterday for lunch chicken Caesar salad"
- Input: "Yesterday I had my favorite breakfast and for lunch my favorite lunch with rice, peas and carrots"
- cleanedQuery: "Yesterday I had my favorite breakfast and for lunch" (if only lunch matches saved favorites)

        **Response Format (JSON only):**
        {
          "isFavoriteMealQuery": boolean,
          "favMealName": "exact description from list above or null",
          "cleanedQuery": "remaining query after removing the favorite meal reference completely",
          "confidence": number (0-100),
          "dateReference": "exact date reference from the query (yesterday, today, Monday, etc.) or null if none found",
          "dateConfidence": number (0-100)
        }
        
        **IMPORTANT**: Always extract the date reference from the original query. If you see "yesterday I had...", the dateReference should be "yesterday". If you see "Monday I ate...", the dateReference should be "Monday".`;
  }

  private parseLLMResponse(response: string): any {
    try {
      // Clean the response to extract JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        const result = JSON.parse(jsonStr);

        return {
          isFavoriteMealQuery: result.isFavoriteMealQuery || false,
          favMealName: result.favMealName || null,
          cleanedQuery: result.cleanedQuery || null,
          confidence: result.confidence || 0,
          dateReference: result.dateReference || null,
          dateConfidence: result.dateConfidence || 0,
        };
      }
    } catch (error) {
      console.error("Error parsing LLM response:", error);
    }

    // Fallback response
    return {
      isFavoriteMealQuery: false,
      favMealName: null,
      cleanedQuery: null,
      confidence: 0,
      dateReference: null,
      dateConfidence: 0,
    };
  }
}

/**
 * Checks if a query contains favorite meal references using LLM
 * @param userQuery - The user's query text
 * @returns boolean indicating if this is a favorite meal reference
 */
export async function isFavoriteMealReferenceLLM(
  userQuery: string
): Promise<boolean> {
  try {
    const llm = new ChatOpenAI({
      openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.1,
    });

    const prompt = `Analyze this user query and determine if it contains references to favorite/saved meals.

**Query:** "${userQuery}"

**Favorite meal reference indicators include:**
- Direct references: "my favorite", "favorite breakfast/lunch/dinner"
- Vague descriptions: "my usual", "go-to meal", "that meal I saved"
- References to previously saved meals: "the yogurt breakfast", "my chicken meal"
- Meal type + ingredient combinations that suggest saved meals

**Response:** Answer with only "true" or "false"`;

    const response = await llm.invoke(prompt);
    const result = (response.content as string).toLowerCase().trim();

    return result === "true";
  } catch (error) {
    console.error("Error in LLM favorite meal detection:", error);
    // Fallback to simple keyword matching
    const queryLower = userQuery.toLowerCase();
    const favoriteKeywords = [
      "favorite",
      "my favorite",
      "usual",
      "go-to",
      "saved meal",
      "that meal",
    ];
    return favoriteKeywords.some((keyword) => queryLower.includes(keyword));
  }
}
