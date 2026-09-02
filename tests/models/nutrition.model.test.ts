import mockPrisma from "../__mocks__/prismaClient";
import NutritionService from "../../src/services/nutrition/model/nutrition.model";
import moment from "moment-timezone";
// Mock Prisma client
jest.mock("../../src/utility/prismaClient", () => ({
  __esModule: true,
  default: {
    ...mockPrisma,
  },
}));

jest.mock("moment-timezone", () => {
  const moment = jest.requireActual("moment-timezone"); // Get the actual moment object
  return {
    ...moment,
    tz: jest.fn(() => ({
      startOf: jest.fn().mockReturnThis(),
      endOf: jest.fn().mockReturnThis(),
      format: jest.fn(() => "2024-11-30T00:00:00.000Z"), // Example date
    })),
  };
});

describe("NutritionService.createTracker", () => {
  const mockUserId = "test-user-id";
  const mockNutrientsLimit = {
    carbohydratesLimit: 250,
    proteinsLimit: 150,
    fatsLimit: 70,
    fiberLimit: 30,
    sodiumLimit: 2000,
    naturalSugarLimit: 25,
    addedSugarLimit: 10,
    calciumLimit: 1000,
    magnesiumLimit: 400,
    ironLimit: 18,
    potassiumLimit: 3500,
    omega_3Limit: 400,
    cholesterolLimit: 300,
    zincLimit: 15,
    vitaminDLimit: 20,
    vitaminCLimit: 90,
    vitaminB12Limit: 2.4,
    vitaminELimit: 15,
  };

  const mockTracker = {
    id: "test-tracker-id",
    userId: mockUserId,
    ...mockNutrientsLimit,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create a new tracker if none exists", async () => {
    // Mock Prisma responses
    mockPrisma.macroNutrientsTracker.findUnique.mockResolvedValue(null);
    mockPrisma.macroNutrientsTracker.create.mockResolvedValue(mockTracker);

    // Mock the `generateNutrientsTotalAmount` method
    const generateNutrientsMock = jest.spyOn(
      NutritionService,
      "generateNutrientsTotalAmount"
    );
    generateNutrientsMock.mockResolvedValue(mockNutrientsLimit);

    const result = await NutritionService.createTracker(mockUserId);

    // Verify the methods are called with expected arguments
    expect(mockPrisma.macroNutrientsTracker.findUnique).toHaveBeenCalledWith({
      where: { userId: mockUserId },
    });
    expect(generateNutrientsMock).toHaveBeenCalledWith(mockUserId);
    expect(mockPrisma.macroNutrientsTracker.create).toHaveBeenCalledWith({
      data: {
        ...mockNutrientsLimit,
        userId: mockUserId,
      },
    });

    // Verify the result
    expect(result).toEqual(mockTracker);
  });

  it("should throw an error if a tracker already exists", async () => {
    // Mock an existing tracker
    mockPrisma.macroNutrientsTracker.findUnique.mockResolvedValue(mockTracker);

    await expect(NutritionService.createTracker(mockUserId)).rejects.toThrow(
      "Tracker already exists for this user."
    );

    // Ensure `generateNutrientsTotalAmount` is not called
    const generateNutrientsMock = jest.spyOn(
      NutritionService,
      "generateNutrientsTotalAmount"
    );
    expect(generateNutrientsMock).not.toHaveBeenCalled();
  });

  it("should throw an error if tracker creation fails", async () => {
    mockPrisma.macroNutrientsTracker.findUnique.mockResolvedValue(null);

    // Mock `generateNutrientsTotalAmount` to return limits
    const generateNutrientsMock = jest.spyOn(
      NutritionService,
      "generateNutrientsTotalAmount"
    );
    generateNutrientsMock.mockResolvedValue(mockNutrientsLimit);

    // Mock Prisma `create` to throw an error
    mockPrisma.macroNutrientsTracker.create.mockRejectedValue(
      new Error("Database error")
    );

    await expect(NutritionService.createTracker(mockUserId)).rejects.toThrow(
      "Database error"
    );

    // Ensure the mocked methods were called
    expect(mockPrisma.macroNutrientsTracker.findUnique).toHaveBeenCalledWith({
      where: { userId: mockUserId },
    });
    expect(generateNutrientsMock).toHaveBeenCalledWith(mockUserId);
    expect(mockPrisma.macroNutrientsTracker.create).toHaveBeenCalled();
  });
});

// describe("NutritionService.createDailyNutrientTracker", () => {
//   const mockUserId = "test-user-id";
//   const mockTimeZone = "America/New_York";
//   const mockMainTracker = {
//     id: "main-tracker-id",
//     userId: mockUserId,
//     createdAt: new Date("2024-12-01T00:00:00.000Z"),
//     carbohydratesLimit: 250,
//     proteinsLimit: 150,
//     fatsLimit: 70,
//     fiberLimit: 30,
//     sodiumLimit: 2000,
//     naturalSugarLimit: 25,
//     addedSugarLimit: 10,
//     calciumLimit: 1000,
//     magnesiumLimit: 400,
//     ironLimit: 18,
//     potassiumLimit: 3500,
//     omega_3Limit: 400,
//     cholesterolLimit: 300,
//     zincLimit: 15,
//     vitaminDLimit: 20,
//     vitaminCLimit: 90,
//     vitaminB12Limit: 2.4,
//     vitaminELimit: 15,
//   };
//   const mockDailyTracker = {
//     id: "daily-tracker-id",
//     userId: mockUserId,
//     date: "2024-11-30T00:00:00.000Z",
//     trackerId: mockMainTracker.id,
//   };

//   beforeEach(() => {
//     jest.clearAllMocks();
//   });

//   it("should return an existing daily tracker if found", async () => {
//     // Mock the main tracker retrieval
//     mockPrisma.macroNutrientsTracker.findUnique.mockResolvedValue(
//       mockMainTracker
//     );

//     // Mock the existing daily tracker retrieval
//     mockPrisma.dailyNutrients.findFirst.mockResolvedValue(mockDailyTracker);

//     const result = await NutritionService.createDailyNutrientTracker(
//       mockUserId,
//       null,
//       mockTimeZone
//     );

//     // Verify the result
//     expect(result).toEqual(mockDailyTracker);

//     // Verify the methods are called with expected arguments
//     expect(mockPrisma.macroNutrientsTracker.findUnique).toHaveBeenCalledWith({
//       where: { userId: mockUserId },
//     });
//     expect(mockPrisma.dailyNutrients.findFirst).toHaveBeenCalledWith({
//       where: {
//         trackerId: mockMainTracker.id,
//         date: {
//           gte: "2024-11-30T00:00:00.000Z",
//           lte: "2024-11-30T23:59:59.999Z",
//         },
//       },
//     });

//     // Ensure the daily tracker creation method is NOT called
//     expect(mockPrisma.dailyNutrients.create).not.toHaveBeenCalled();
//   });
// });

jest.mock("../../src/utility/prismaClient", () => ({
  __esModule: true,
  default: {
    ...mockPrisma,
  },
}));

describe("NutritionService.getNutrientsTracker", () => {
  const mockWhere = { userId: "test-user-id" };
  const mockTracker = {
    id: "tracker-id",
    userId: "test-user-id",
    carbohydratesLimit: 250,
    proteinsLimit: 150,
    fatsLimit: 70,
    dailyEntries: [
      { id: "daily-1", date: "2024-12-14T00:00:00.000Z" },
      { id: "daily-2", date: "2024-12-15T00:00:00.000Z" },
    ],
    weeklyEntries: [
      { id: "weekly-1", weekStartDate: "2024-12-09T00:00:00.000Z" },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return the tracker when found", async () => {
    // Mock the tracker retrieval
    mockPrisma.macroNutrientsTracker.findUnique.mockResolvedValue(mockTracker);

    const result = await NutritionService.getNutrientsTracker(mockWhere);

    // Verify the result
    expect(result).toEqual(mockTracker);

    // Verify the Prisma method is called with expected arguments
    expect(mockPrisma.macroNutrientsTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: { dailyEntries: true, weeklyEntries: true },
    });
  });

  it("should return null when the tracker is not found", async () => {
    // Mock no tracker found
    mockPrisma.macroNutrientsTracker.findUnique.mockResolvedValue(null);

    const result = await NutritionService.getNutrientsTracker(mockWhere);

    // Verify the result
    expect(result).toBeNull();

    // Verify the Prisma method is called with expected arguments
    expect(mockPrisma.macroNutrientsTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: { dailyEntries: true, weeklyEntries: true },
    });
  });

  it("should throw an error when an exception occurs", async () => {
    // Mock an error
    mockPrisma.macroNutrientsTracker.findUnique.mockRejectedValue(
      new Error("Database error")
    );

    await expect(
      NutritionService.getNutrientsTracker(mockWhere)
    ).rejects.toThrow("Database error");

    // Verify the Prisma method is called with expected arguments
    expect(mockPrisma.macroNutrientsTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: { dailyEntries: true, weeklyEntries: true },
    });
  });
});

describe("NutritionService.createFavMeal", () => {
  const mockPatientId = "test-patient-id";
  const mockDescription = "Healthy breakfast";
  const mockMealType = "BREAKFAST";

  /**
   * A favourite is saved from food entries the user already logged. The
   * per-ingredient rows are copied from the DB (not from the request) so
   * logging it later is a verbatim copy; the scalar macro columns are a cache
   * recomputed from those rows.
   */
  const mockEntries = [
    {
      id: "food1",
      description: "Grilled Chicken",
      quantity: "1",
      calories: 999, // ignored — the ingredient rows are the truth
      ingredients: [
        {
          sortOrder: 0,
          name: "Grilled chicken breast",
          searchTerm: "chicken breast, grilled",
          brand: null,
          quantity: 150,
          unit: "g",
          grams: 150,
          gramsLow: 130,
          gramsHigh: 180,
          portionSource: "personalized_default",
          portionAssumption: "Assumed a 150 g breast",
          confidence: 0.8,
          foodGroup: "protein",
          isProcessedFood: false,
          glycemicIndex: 0,
          calories: 250,
          nutrients: { proteins: 46, carbohydrates: 0, fats: 6, vegetableServings: 0, fruitServings: 0 },
          per100g: null,
          nutrientSource: "usda",
          referenceSource: "usda",
          referenceId: "171077",
          referenceDescription: "Chicken, broilers or fryers, breast",
        },
      ],
    },
    {
      id: "food2",
      description: "Roasted Veggies",
      quantity: "1 cup",
      calories: 150,
      proteins: 4,
      carbohydrates: 20,
      fats: 7,
      ingredients: [], // legacy shape: no breakdown
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.foodEntry.findMany.mockResolvedValue(mockEntries);
  });

  it("copies ingredient rows from the logged entries and recomputes the totals", async () => {
    mockPrisma.favMeal.create.mockResolvedValue({ id: "fav1" });

    const result = await NutritionService.createFavMeal(
      [{ id: "food1" }, { id: "food2" }] as any,
      mockPatientId,
      mockDescription,
      mockMealType,
      { slot: "BREAKFAST", aliases: ["the chicken one"] }
    );
    expect(result).toEqual({ id: "fav1" });

    // Entries come from the DB, not from the request body.
    expect(mockPrisma.foodEntry.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["food1", "food2"] } },
      include: { ingredients: { orderBy: { sortOrder: "asc" } } },
    });

    const arg = mockPrisma.favMeal.create.mock.calls[0][0];
    const created = arg.data.ingredients.create;
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      sortOrder: 0,
      name: "Grilled chicken breast",
      grams: 150,
      gramsLow: 130,
      gramsHigh: 180,
      portionSource: "personalized_default",
      nutrientSource: "usda",
      referenceId: "171077",
    });
    // The legacy entry becomes one ingredient, frozen against the portion dial.
    expect(created[1]).toMatchObject({ name: "Roasted Veggies", calories: 150, portionSource: "user" });

    // Totals are the sum of the ingredients (250 + 150), not the entries' own numbers.
    expect(arg.data).toMatchObject({
      userId: mockPatientId,
      description: mockDescription,
      mealType: mockMealType,
      slot: "BREAKFAST",
      aliases: ["the chicken one"],
      calories: 400,
      proteins: 50,
      carbohydrates: 20,
      fats: 13,
    });
    // Legacy links are kept until FoodEntry.favMealId is dropped.
    expect(arg.data.legacyEntries).toEqual({ connect: [{ id: "food1" }, { id: "food2" }] });
  });

  it("throws when none of the food entries exist", async () => {
    mockPrisma.foodEntry.findMany.mockResolvedValue([]);
    await expect(
      NutritionService.createFavMeal([{ id: "missing" }] as any, mockPatientId, mockDescription, mockMealType)
    ).rejects.toThrow(/No food entries found/);
    expect(mockPrisma.favMeal.create).not.toHaveBeenCalled();
  });

  it("should throw an error when Prisma throws an error", async () => {
    mockPrisma.favMeal.create.mockRejectedValue(new Error("Database error"));
    await expect(
      NutritionService.createFavMeal([{ id: "food1" }] as any, mockPatientId, mockDescription, mockMealType)
    ).rejects.toThrow("Database error");
  });
});
