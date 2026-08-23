import mockPrisma from "../__mocks__/prismaClient";
import CaloriesService from "../../src/services/calories_tracker/model/calories.model";
import moment from "moment-timezone";

jest.mock("../../src/utility/prismaClient", () => ({
  __esModule: true,
  default: {
    ...mockPrisma,
  },
}));

jest.mock("moment-timezone", () => {
  const actualMoment = jest.requireActual("moment-timezone");
  return {
    ...actualMoment,
    tz: jest.fn(() => ({
      startOf: jest.fn(() => ({
        format: jest.fn(() => "2024-11-30T00:00:00.000Z"),
        endOf: jest.fn(() => ({
          format: jest.fn(() => "2024-11-30T23:59:59.999Z"),
        })),
      })),
    })),
  };
});

// describe("CaloriesService.createDailyTracker", () => {
//   beforeEach(() => {
//     jest.clearAllMocks();
//   });

//   it("should create a tracker if none exists", async () => {
//     // Mock Prisma responses
//     mockPrisma.caloriesTracker.findUnique.mockResolvedValue(null);
//     jest.spyOn(CaloriesService, "createTracker").mockResolvedValue({
//       id: "new-tracker-id",
//       userId: "user1",
//       createdAt: new Date(),
//     });
//     mockPrisma.dailyCalories.findFirst.mockResolvedValue(null);
//     mockPrisma.dailyCalories.create.mockResolvedValue({
//       id: "daily-tracker-id",
//       userId: "user1",
//       caloriesBurned: 500,
//       caloriesIntake: 2000,
//       date: "2024-11-30T00:00:00.000Z",
//       trackerId: "new-tracker-id",
//     });

//     const result = await CaloriesService.createDailyTracker(
//       "user1",
//       500,
//       2000,
//       null,
//       "UTC"
//     );

//     expect(mockPrisma.caloriesTracker.findUnique).toHaveBeenCalledWith({
//       where: { userId: "user1" },
//     });
//     expect(CaloriesService.createTracker).toHaveBeenCalledWith("user1");
//     expect(mockPrisma.dailyCalories.create).toHaveBeenCalledWith({
//       data: {
//         userId: "user1",
//         caloriesBurned: 500,
//         caloriesIntake: 2000,
//         date: "2024-11-30T00:00:00.000Z",
//         trackerId: "new-tracker-id",
//       },
//     });
//     expect(result).toEqual({
//       id: "daily-tracker-id",
//       userId: "user1",
//       caloriesBurned: 500,
//       caloriesIntake: 2000,
//       date: "2024-11-30T00:00:00.000Z",
//       trackerId: "new-tracker-id",
//     });
//   });
// });

describe("Create a new calories tracker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return the existing tracker if one already exists", async () => {
    // Mock Prisma response for an existing tracker
    mockPrisma.caloriesTracker.findUnique.mockResolvedValue({
      id: "existing-tracker-id",
      userId: "user1",
      createdAt: new Date(),
    });

    const result = await CaloriesService.createTracker("user1");

    expect(mockPrisma.caloriesTracker.findUnique).toHaveBeenCalledWith({
      where: { userId: "user1" },
    });
    expect(mockPrisma.caloriesTracker.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: "existing-tracker-id",
      userId: "user1",
      createdAt: expect.any(Date),
    });
  });

  it("should create a new tracker if none exists", async () => {
    // Mock Prisma response for no existing tracker
    mockPrisma.caloriesTracker.findUnique.mockResolvedValue(null);

    // Mock Prisma response for creating a new tracker
    mockPrisma.caloriesTracker.create.mockResolvedValue({
      id: "new-tracker-id",
      userId: "user1",
      createdAt: new Date(),
    });

    const result = await CaloriesService.createTracker("user1");

    expect(mockPrisma.caloriesTracker.findUnique).toHaveBeenCalledWith({
      where: { userId: "user1" },
    });
    expect(mockPrisma.caloriesTracker.create).toHaveBeenCalledWith({
      data: { userId: "user1" },
    });
    expect(result).toEqual({
      id: "new-tracker-id",
      userId: "user1",
      createdAt: expect.any(Date),
    });
  });

  it("should throw an error if Prisma operations fail", async () => {
    // Mock Prisma response for a failure
    mockPrisma.caloriesTracker.findUnique.mockRejectedValue(
      new Error("Database error")
    );

    await expect(CaloriesService.createTracker("user1")).rejects.toThrow(
      "Database error"
    );

    expect(mockPrisma.caloriesTracker.findUnique).toHaveBeenCalledWith({
      where: { userId: "user1" },
    });
    expect(mockPrisma.caloriesTracker.create).not.toHaveBeenCalled();
  });
});

describe("CaloriesService.getCaloriesTracker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should return the tracker with daily and weekly entries", async () => {
    // Mock Prisma response for a tracker
    mockPrisma.caloriesTracker.findUnique.mockResolvedValue({
      id: "tracker-id",
      userId: "user1",
      dailyEntries: [
        { id: "daily-entry-id1", caloriesBurned: 300, caloriesIntake: 1500 },
      ],
      weeklyEntries: [
        {
          id: "weekly-entry-id1",
          weekStartDate: "2024-11-01",
          weekEndDate: "2024-11-07",
          totalBurned: 2100,
          totalIntake: 10500,
        },
      ],
    });

    const where = { userId: "user-id" };
    const result = await CaloriesService.getCaloriesTracker(where);

    expect(mockPrisma.caloriesTracker.findUnique).toHaveBeenCalledWith({
      where,
      include: {
        dailyEntries: true,
        weeklyEntries: { orderBy: { weekEndDate: "desc" } },
      },
    });

    expect(result).toEqual({
      id: "tracker-id",
      userId: "user1",
      dailyEntries: [
        { id: "daily-entry-id1", caloriesBurned: 300, caloriesIntake: 1500 },
      ],
      weeklyEntries: [
        {
          id: "weekly-entry-id1",
          weekStartDate: "2024-11-01",
          weekEndDate: "2024-11-07",
          totalBurned: 2100,
          totalIntake: 10500,
        },
      ],
    });
  });

  it("should return null if no tracker is found", async () => {
    // Mock Prisma response for no tracker
    mockPrisma.caloriesTracker.findUnique.mockResolvedValue(null);

    const where = { userId: "non-existent-user-id" };
    const result = await CaloriesService.getCaloriesTracker(where);

    expect(mockPrisma.caloriesTracker.findUnique).toHaveBeenCalledWith({
      where,
      include: {
        dailyEntries: true,
        weeklyEntries: { orderBy: { weekEndDate: "desc" } },
      },
    });

    expect(result).toBeNull();
  });

  it("should throw an error if Prisma operations fail", async () => {
    // Mock Prisma response for an error
    mockPrisma.caloriesTracker.findUnique.mockRejectedValue(
      new Error("Database error")
    );

    const where = { userId: "user-id" };

    await expect(CaloriesService.getCaloriesTracker(where)).rejects.toThrow(
      "Database error"
    );

    expect(mockPrisma.caloriesTracker.findUnique).toHaveBeenCalledWith({
      where,
      include: {
        dailyEntries: true,
        weeklyEntries: { orderBy: { weekEndDate: "desc" } },
      },
    });
  });
});

describe("Create a new food tracker",()=>{
    beforeEach(()=>{
        jest.clearAllMocks()
    })

    it("should return existing tracker if one already exist",async()=>{
        mockPrisma.foodTracker.findUnique.mockResolvedValue({
            id:"existing-tracker-id",
            userId:"user1",
            createdAt:new Date()
        })
    })
})