import { allergiesIn, allergenTerms, findAllergen } from "../../src/utils/allergens";

describe("allergens — stored categories find the foods in them", () => {
  it.each([
    ["Shellfish", "150 g shrimp, garlic, butter", "shrimp"],
    ["Shellfish", "Linguine with clams", "clam"],
    ["Fish", "Baked salmon fillet", "salmon"],
    ["Tree nuts", "30 g almonds", "almond"],
    ["Peanuts", "2 tbsp peanut butter", "peanut"],
    ["Dairy", "40 g parmesan", "parmesan"],
    ["Dairy", "Greek yogurt with honey", "yogurt"],
    ["Eggs", "3 eggs, scrambled", "eggs"],
    ["Eggs", "Spaghetti carbonara", "carbonara"],
    ["Gluten", "100 g dry penne", "penne"],
    ["Wheat", "2 slices whole wheat bread", "wheat"],
    ["Soy", "150 g firm tofu", "tofu"],
    ["Sesame", "Hummus with pita", "hummus"],
  ])("%s ⟶ %s", (allergy, line, term) => {
    expect(findAllergen(line, allergy)).toBe(term);
  });
});

describe("allergens — look-alikes that are not the allergen", () => {
  it.each([
    ["Dairy", "200 ml coconut milk"],
    ["Dairy", "1 tbsp almond butter"],
    ["Dairy", "roasted butternut squash"],
    ["Eggs", "grilled eggplant"],
    ["Gluten", "gluten-free pasta"],
    ["Gluten", "rice noodles with vegetables"],
    ["Gluten", "2 corn tortillas"],
    ["Gluten", "a bunch of basil"],
    ["Gluten", "toasted pumpkin seeds"],
    ["Tree nuts", "coconut yogurt with nutmeg"],
    ["Fish", "shellfish stock"], // shellfish is its own category
  ])("%s ∌ %s", (allergy, line) => {
    expect(findAllergen(line, allergy)).toBeNull();
  });
});

describe("allergens — helpers", () => {
  it("an allergy the table doesn't know still matches its own word", () => {
    expect(allergenTerms("Kiwi")).toEqual(["kiwi"]);
    expect(findAllergen("sliced kiwis", "Kiwi")).toBe("kiwi");
  });
  it("allergiesIn names each tripped allergy once, as stored", () => {
    expect(allergiesIn(["shrimp scampi", "parmesan", "more shrimp"], ["Shellfish", "Dairy", "Peanuts"])).toEqual(["Shellfish", "Dairy"]);
  });
});
