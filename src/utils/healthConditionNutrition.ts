export interface HealthConditionNutrition {
  condition: string;
  portionGuidelines: string[];
  nutritionFocus: string[];
  restrictions: string[];
  recommendations: string[];
  mealTiming?: string[];
}

export const HEALTH_CONDITION_NUTRITION_MAP: HealthConditionNutrition[] = [
  {
    condition: "diabetes",
    portionGuidelines: [
      "Limit carbohydrate portions to 15-30g per meal",
      "Use the plate method: 1/2 non-starchy vegetables, 1/4 lean protein, 1/4 whole grains",
      "Monitor portion sizes of fruits (1 small piece or 1/2 cup)",
      "Space meals 3-4 hours apart to maintain stable blood sugar",
    ],
    nutritionFocus: [
      "High fiber foods (25-30g daily)",
      "Complex carbohydrates over simple sugars",
      "Lean proteins (fish, poultry, legumes)",
      "Healthy fats (avocado, nuts, olive oil)",
    ],
    restrictions: [
      "Limit added sugars to <25g daily",
      "Avoid refined carbohydrates",
      "Limit fruit juice and dried fruits",
      "Avoid high glycemic index foods",
    ],
    recommendations: [
      "Include protein with every meal to slow glucose absorption",
      "Choose whole grains over refined grains",
      "Eat at consistent times daily",
      "Monitor blood sugar response to different foods",
    ],
    mealTiming: [
      "Eat within 1 hour of waking",
      "Space meals 3-4 hours apart",
      "Include a small protein-rich snack if going >4 hours between meals",
    ],
  },
  {
    condition: "hypertension",
    portionGuidelines: [
      "Limit sodium to 1,500-2,300mg daily",
      "Use the DASH diet plate: 6-8 servings grains, 4-5 vegetables, 4-5 fruits",
      "Limit processed meats to 2-3 servings weekly",
      "Include 2-3 servings of low-fat dairy daily",
    ],
    nutritionFocus: [
      "Potassium-rich foods (bananas, spinach, sweet potatoes)",
      "Calcium-rich foods (dairy, fortified plant milk)",
      "Magnesium-rich foods (nuts, seeds, whole grains)",
      "Omega-3 fatty acids (fatty fish, flaxseeds)",
    ],
    restrictions: [
      "Sodium <2,300mg daily (ideally <1,500mg)",
      "Limit alcohol to 1-2 drinks daily",
      "Avoid processed and canned foods",
      "Limit saturated and trans fats",
    ],
    recommendations: [
      "Use herbs and spices instead of salt",
      "Choose fresh or frozen vegetables over canned",
      "Read nutrition labels for sodium content",
      "Include potassium-rich foods with each meal",
    ],
  },
  {
    condition: "heart disease",
    portionGuidelines: [
      "Limit saturated fat to <7% of daily calories",
      "Include 2 servings of fatty fish weekly",
      "Use the Mediterranean plate: 1/2 vegetables, 1/4 whole grains, 1/4 lean protein",
      "Limit red meat to 1-2 servings weekly",
    ],
    nutritionFocus: [
      "Omega-3 fatty acids (salmon, mackerel, sardines)",
      "Soluble fiber (oats, beans, apples)",
      "Antioxidant-rich foods (berries, dark chocolate, nuts)",
      "Plant sterols (fortified foods)",
    ],
    restrictions: [
      "Saturated fat <7% of daily calories",
      "Trans fats <1% of daily calories",
      "Cholesterol <200mg daily",
      "Limit processed meats and fried foods",
    ],
    recommendations: [
      "Choose lean proteins (fish, poultry, legumes)",
      "Include nuts and seeds daily (1/4 cup)",
      "Use olive oil instead of butter",
      "Eat plenty of colorful vegetables and fruits",
    ],
  },
  {
    condition: "obesity",
    portionGuidelines: [
      "Use smaller plates (9-inch diameter)",
      "Fill 1/2 plate with non-starchy vegetables",
      "Limit portion sizes to palm-sized protein, fist-sized carbs",
      "Eat slowly and stop when 80% full",
    ],
    nutritionFocus: [
      "High-fiber foods for satiety",
      "Lean proteins to preserve muscle mass",
      "Low-calorie density foods (vegetables, fruits)",
      "Adequate hydration (8-10 cups water daily)",
    ],
    restrictions: [
      "Limit added sugars to <25g daily",
      "Avoid liquid calories (sodas, juices)",
      "Limit processed foods",
      "Avoid eating after 8 PM",
    ],
    recommendations: [
      "Eat protein with every meal",
      "Include fiber-rich foods for fullness",
      "Practice mindful eating",
      "Keep a food diary to track intake",
    ],
    mealTiming: [
      "Eat breakfast within 1 hour of waking",
      "Include protein with every meal",
      "Avoid eating 2-3 hours before bedtime",
    ],
  },
  {
    condition: "celiac disease",
    portionGuidelines: [
      "Ensure all grains are certified gluten-free",
      "Read labels carefully for hidden gluten",
      "Use separate cooking utensils and surfaces",
      "Include adequate fiber from gluten-free sources",
    ],
    nutritionFocus: [
      "Naturally gluten-free whole grains (quinoa, rice, corn)",
      "Fresh fruits and vegetables",
      "Lean proteins (meat, fish, poultry, eggs)",
      "Dairy products (if tolerated)",
    ],
    restrictions: [
      "Strictly avoid wheat, rye, barley, and triticale",
      "Avoid cross-contamination",
      "Check medications and supplements for gluten",
      "Avoid processed foods unless certified gluten-free",
    ],
    recommendations: [
      "Choose certified gluten-free products",
      "Include a variety of gluten-free grains",
      "Ensure adequate B vitamins from fortified foods",
      "Consider working with a registered dietitian",
    ],
  },
  {
    condition: "kidney disease",
    portionGuidelines: [
      "Limit protein to 0.6-0.8g per kg body weight",
      "Control potassium intake based on lab results",
      "Limit phosphorus to 800-1,000mg daily",
      "Monitor fluid intake based on urine output",
    ],
    nutritionFocus: [
      "High-quality proteins (eggs, fish, lean meat)",
      "Low-potassium vegetables (cabbage, cauliflower, green beans)",
      "Low-phosphorus foods",
      "Adequate calories to prevent muscle loss",
    ],
    restrictions: [
      "Limit sodium to 1,500-2,300mg daily",
      "Control potassium intake",
      "Limit phosphorus",
      "Avoid high-sodium processed foods",
    ],
    recommendations: [
      "Work with a renal dietitian",
      "Monitor lab values regularly",
      "Choose fresh foods over processed",
      "Limit dairy and nuts due to phosphorus content",
    ],
  },
  {
    condition: "inflammatory bowel disease",
    portionGuidelines: [
      "Eat smaller, more frequent meals (5-6 daily)",
      "Limit fiber during flare-ups",
      "Include easily digestible foods",
      "Stay well-hydrated (8-10 cups daily)",
    ],
    nutritionFocus: [
      "Low-fiber foods during flares",
      "Lean proteins for healing",
      "Probiotic-rich foods (yogurt, kefir)",
      "Anti-inflammatory foods (turmeric, ginger)",
    ],
    restrictions: [
      "Limit high-fiber foods during flares",
      "Avoid spicy and fried foods",
      "Limit caffeine and alcohol",
      "Avoid raw vegetables during flares",
    ],
    recommendations: [
      "Keep a food diary to identify triggers",
      "Eat slowly and chew thoroughly",
      "Include omega-3 fatty acids",
      "Consider a low-FODMAP diet if recommended",
    ],
  },
  {
    condition: "lactose intolerance",
    portionGuidelines: [
      "Limit dairy to tolerance level",
      "Include calcium from non-dairy sources",
      "Use lactose-free dairy products",
      "Include small amounts of dairy with meals",
    ],
    nutritionFocus: [
      "Calcium-rich non-dairy foods (fortified plant milk, leafy greens)",
      "Vitamin D sources (fatty fish, eggs, fortified foods)",
      "Lactose-free dairy products",
      "Plant-based protein sources",
    ],
    restrictions: [
      "Limit or avoid high-lactose dairy products",
      "Read labels for hidden dairy ingredients",
      "Avoid large amounts of dairy at once",
      "Be cautious with processed foods containing dairy",
    ],
    recommendations: [
      "Choose lactose-free dairy products",
      "Include calcium-fortified foods",
      "Take lactase enzyme supplements if needed",
      "Include vitamin D for calcium absorption",
    ],
  },
];

export function getHealthConditionNutrition(
  conditionName: string
): HealthConditionNutrition | null {
  const normalizedCondition = conditionName.toLowerCase().trim();

  return (
    HEALTH_CONDITION_NUTRITION_MAP.find(
      (condition) =>
        condition.condition.toLowerCase() === normalizedCondition ||
        condition.condition.toLowerCase().includes(normalizedCondition) ||
        normalizedCondition.includes(condition.condition.toLowerCase())
    ) || null
  );
}

export function generateHealthConditionPrompt(conditions: string[]): string {
  if (!conditions || conditions.length === 0) {
    return "";
  }

  const relevantConditions = conditions
    .map((condition) => getHealthConditionNutrition(condition))
    .filter((condition) => condition !== null);

  if (relevantConditions.length === 0) {
    return "";
  }

  let prompt = "\n\n**SPECIFIC HEALTH CONDITION GUIDELINES:**\n";

  relevantConditions.forEach((condition) => {
    prompt += `\n**${condition.condition.toUpperCase()} CONSIDERATIONS:**\n`;

    if (condition.portionGuidelines.length > 0) {
      prompt += `- **Portion Guidelines**: ${condition.portionGuidelines.join(
        "; "
      )}\n`;
    }

    if (condition.nutritionFocus.length > 0) {
      prompt += `- **Nutrition Focus**: ${condition.nutritionFocus.join(
        "; "
      )}\n`;
    }

    if (condition.restrictions.length > 0) {
      prompt += `- **Restrictions**: ${condition.restrictions.join("; ")}\n`;
    }

    if (condition.recommendations.length > 0) {
      prompt += `- **Recommendations**: ${condition.recommendations.join(
        "; "
      )}\n`;
    }

    if (condition.mealTiming && condition.mealTiming.length > 0) {
      prompt += `- **Meal Timing**: ${condition.mealTiming.join("; ")}\n`;
    }
  });

  return prompt;
}

export function getConditionSpecificPortionAdvice(
  conditions: string[]
): string {
  const relevantConditions = conditions
    .map((condition) => getHealthConditionNutrition(condition))
    .filter((condition) => condition !== null);

  if (relevantConditions.length === 0) {
    return "";
  }

  let portionAdvice = "\n**CONDITION-SPECIFIC PORTION GUIDELINES:**\n";

  relevantConditions.forEach((condition) => {
    portionAdvice += `\nFor ${
      condition.condition
    }: ${condition.portionGuidelines.join("; ")}\n`;
  });

  return portionAdvice;
}
