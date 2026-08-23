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
  const mockMealType = "Breakfast";
  const mockFoodEntries = [
    {
      id: "food1",
      description: "Grilled Chicken",
      quantity: "1",
      calories: 200,
      dailyFoodId: "daily1",
      favMealId: null,
      carbohydrates: 30,
      proteins: 10,
      fats: 5,
      fiber: 3,
      sodium: 100,
      naturalSugar: 5,
      addedSugar: 2,
      calcium: 20,
      magnesium: 10,
      iron: 2,
      potassium: 50,
      omega_3: 1,
      cholesterol: 10,
      zinc: 5,
      vitaminD: 2,
      vitaminC: 15,
      vitaminB12: 0.5,
      vitaminE: 3,
      createdAt: "2024-12-14T00:00:00.000Z",
    },
    {
      id: "food2",
      description: "Roasted Veggies",
      quantity: "1",
      calories: 150,
      dailyFoodId: "daily2",
      favMealId: null,
      carbohydrates: 20,
      proteins: 15,
      fats: 7,
      fiber: 2,
      sodium: 80,
      naturalSugar: 3,
      addedSugar: 1,
      calcium: 25,
      magnesium: 15,
      iron: 3,
      potassium: 70,
      omega_3: 2,
      cholesterol: 15,
      zinc: 6,
      vitaminD: 3,
      vitaminC: 20,
      vitaminB12: 0.8,
      vitaminE: 4,
      createdAt: "2024-12-14T00:00:00.000Z",
    },
  ];

  const mockFavMeal = {
    id: "favMeal1",
    userId: mockPatientId,
    description: mockDescription,
    mealType: mockMealType,
    quantity: "1",
    calories: 350,
    carbohydrates: 50,
    proteins: 25,
    fats: 12,
    fiber: 5,
    sodium: 180,
    naturalSugar: 8,
    addedSugar: 3,
    calcium: 45,
    magnesium: 25,
    iron: 5,
    potassium: 120,
    omega_3: 3,
    cholesterol: 25,
    zinc: 11,
    vitaminD: 5,
    vitaminC: 35,
    vitaminB12: 1.3,
    vitaminE: 7,
    ingredients: mockFoodEntries.map((entry) => ({ id: entry.id })),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create a favorite meal successfully", async () => {
    // Mock the Prisma create call
    mockPrisma.favMeal.create.mockResolvedValue(mockFavMeal);

    const result = await NutritionService.createFavMeal(
      mockFoodEntries,
      mockPatientId,
      mockDescription,
      mockMealType
    );

    // Verify the result
    expect(result).toEqual(mockFavMeal);

    // Verify Prisma call
    expect(mockPrisma.favMeal.create).toHaveBeenCalledWith({
      data: {
        userId: mockPatientId,
        description: mockDescription,
        mealType: mockMealType,
        quantity: "1",
        ingredients: {
          connect: mockFoodEntries.map((entry) => ({ id: entry.id })),
        },
        calories: 350,
        carbohydrates: 50,
        proteins: 25,
        fats: 12,
        fiber: 5,
        sodium: 180,
        naturalSugar: 8,
        addedSugar: 3,
        calcium: 45,
        magnesium: 25,
        iron: 5,
        potassium: 120,
        omega_3: 3,
        cholesterol: 25,
        zinc: 11,
        vitaminD: 5,
        vitaminC: 35,
        vitaminB12: 1.3,
        vitaminE: 7,
      },
    });
  });

  it("should throw an error when Prisma throws an error", async () => {
    // Mock Prisma to throw an error
    mockPrisma.favMeal.create.mockRejectedValue(new Error("Database error"));

    await expect(
      NutritionService.createFavMeal(
        mockFoodEntries,
        mockPatientId,
        mockDescription,
        mockMealType
      )
    ).rejects.toThrow("Database error");

    // Verify Prisma call
    expect(mockPrisma.favMeal.create).toHaveBeenCalledWith({
      data: expect.any(Object),
    });
  });
});
