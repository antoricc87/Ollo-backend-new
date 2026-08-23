import mockPrisma from "../__mocks__/prismaClient";
import ExerciseService from "../../src/services/exercises_tracker/model/exercises.model";

jest.mock("../../src/utility/prismaClient", () => ({
  __esModule: true,
  default: {
    ...mockPrisma,
  },
}));

describe("ExerciseService.createTracker", () => {
  const mockUserId = "test-user-id";
  const mockExistingTracker = {
    id: "existing-tracker-id",
    userId: mockUserId,
  };
  const mockNewTracker = {
    id: "new-tracker-id",
    userId: mockUserId,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return an existing tracker if it already exists", async () => {
    // Mock `findUnique` to return an existing tracker
    mockPrisma.exerciseTracker.findUnique.mockResolvedValue(
      mockExistingTracker
    );

    const result = await ExerciseService.createTracker(mockUserId);

    // Verify the result
    expect(result).toEqual(mockExistingTracker);

    // Verify that `findUnique` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.findUnique).toHaveBeenCalledWith({
      where: { userId: mockUserId },
    });

    // Verify that `create` was not called
    expect(mockPrisma.exerciseTracker.create).not.toHaveBeenCalled();
  });

  it("should create and return a new tracker if none exists", async () => {
    // Mock `findUnique` to return null
    mockPrisma.exerciseTracker.findUnique.mockResolvedValue(null);

    // Mock `create` to return a new tracker
    mockPrisma.exerciseTracker.create.mockResolvedValue(mockNewTracker);

    const result = await ExerciseService.createTracker(mockUserId);

    // Verify the result
    expect(result).toEqual(mockNewTracker);

    // Verify that `findUnique` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.findUnique).toHaveBeenCalledWith({
      where: { userId: mockUserId },
    });

    // Verify that `create` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.create).toHaveBeenCalledWith({
      data: { userId: mockUserId },
    });
  });

  it("should throw an error if an exception occurs", async () => {
    // Mock `findUnique` to throw an error
    mockPrisma.exerciseTracker.findUnique.mockRejectedValue(
      new Error("Database error")
    );

    await expect(ExerciseService.createTracker(mockUserId)).rejects.toThrow(
      "Database error"
    );

    // Verify that `create` was not called
    expect(mockPrisma.exerciseTracker.create).not.toHaveBeenCalled();
  });
});

describe("ExerciseService.getWeeklyExercisesTracker", () => {
  const mockWhere = { userId: "test-user-id" };
  const mockWeeklyEntries = [
    { id: "week1", weekStartDate: "2024-12-01", weekEndDate: "2024-12-07" },
    { id: "week2", weekStartDate: "2024-12-08", weekEndDate: "2024-12-14" },
  ];
  const mockTracker = {
    id: "tracker-id",
    userId: "test-user-id",
    weeklyEntries: mockWeeklyEntries,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return the tracker with weekly entries if found", async () => {
    // Mock the Prisma `findUnique` method to return the tracker
    mockPrisma.exerciseTracker.findUnique.mockResolvedValue(mockTracker);

    const result = await ExerciseService.getWeeklyExercisesTracker(mockWhere);

    // Verify the result
    expect(result).toEqual(mockTracker);

    // Verify that `findUnique` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: {
        weeklyEntries: { orderBy: { weekEndDate: "desc" } },
      },
    });
  });

  it("should return null if the tracker is not found", async () => {
    // Mock the Prisma `findUnique` method to return null
    mockPrisma.exerciseTracker.findUnique.mockResolvedValue(null);

    const result = await ExerciseService.getWeeklyExercisesTracker(mockWhere);

    // Verify the result
    expect(result).toBeNull();

    // Verify that `findUnique` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: {
        weeklyEntries: { orderBy: { weekEndDate: "desc" } },
      },
    });
  });

  it("should throw an error if an exception occurs", async () => {
    // Mock the Prisma `findUnique` method to throw an error
    mockPrisma.exerciseTracker.findUnique.mockRejectedValue(
      new Error("Database error")
    );

    await expect(
      ExerciseService.getWeeklyExercisesTracker(mockWhere)
    ).rejects.toThrow("Database error");

    // Verify that `findUnique` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: {
        weeklyEntries: { orderBy: { weekEndDate: "desc" } },
      },
    });
  });
});

describe("ExerciseService.getWeeklyAndDailyExercisesTracker", () => {
  const mockWhere = { userId: "test-user-id" };

  const mockTracker = {
    id: "tracker-id",
    userId: "test-user-id",
    dailyEntries: [
      { id: "daily1", date: "2024-12-14", caloriesBurned: 200 },
      { id: "daily2", date: "2024-12-15", caloriesBurned: 250 },
    ],
    weeklyEntries: [
      { id: "weekly1", weekStartDate: "2024-12-08", weekEndDate: "2024-12-14" },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return the tracker with daily and weekly entries if found", async () => {
    // Mock the Prisma `findUnique` method to return the tracker
    mockPrisma.exerciseTracker.findUnique.mockResolvedValue(mockTracker);

    const result = await ExerciseService.getWeeklyAndDailyExercisesTracker(
      mockWhere
    );

    // Verify the result
    expect(result).toEqual(mockTracker);

    // Verify that `findUnique` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: {
        dailyEntries: true,
        weeklyEntries: true,
      },
    });
  });

  it("should return null if the tracker is not found", async () => {
    // Mock the Prisma `findUnique` method to return null
    mockPrisma.exerciseTracker.findUnique.mockResolvedValue(null);

    const result = await ExerciseService.getWeeklyAndDailyExercisesTracker(
      mockWhere
    );

    // Verify the result
    expect(result).toBeNull();

    // Verify that `findUnique` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: {
        dailyEntries: true,
        weeklyEntries: true,
      },
    });
  });

  it("should throw an error if an exception occurs", async () => {
    // Mock the Prisma `findUnique` method to throw an error
    mockPrisma.exerciseTracker.findUnique.mockRejectedValue(
      new Error("Database error")
    );

    await expect(
      ExerciseService.getWeeklyAndDailyExercisesTracker(mockWhere)
    ).rejects.toThrow("Database error");

    // Verify that `findUnique` was called with the correct arguments
    expect(mockPrisma.exerciseTracker.findUnique).toHaveBeenCalledWith({
      where: mockWhere,
      include: {
        dailyEntries: true,
        weeklyEntries: true,
      },
    });
  });
});
