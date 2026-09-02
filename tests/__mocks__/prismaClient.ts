const mockPrisma = {
  patient: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  patientSummary: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  caloriesTracker: {
    findUnique: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  exerciseTracker: {
    findUnique: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  userToken: {
    create: jest.fn(),
    deleteMany: jest.fn(),
    findFirst: jest.fn(),
  },
  vitalsSummary: {
    deleteMany: jest.fn(),
  },
  labResultSummary: {
    findMany: jest.fn(),
  },
  labResult: {
    delete: jest.fn(),
  },
  procedureSummary: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  procedure: {
    delete: jest.fn(),
  },
  medicationSummary: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  medication: {
    delete: jest.fn(),
  },
  conditionSummary: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  condition: {
    delete: jest.fn(),
  },
  allergySummary: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  allergy: {
    delete: jest.fn(),
  },
  exerciseSummary: {
    deleteMany: jest.fn(),
  },
  nutritionSummary: {
    deleteMany: jest.fn(),
  },
  weightTracker: {
    deleteMany: jest.fn(),
  },

  foodTracker: {
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
  },
  macroNutrientsTracker: {
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  favFood: {
    deleteMany: jest.fn(),
  },
  favMeal: {
    create: jest.fn(),
  },
  // createFavMeal loads the entries from the DB rather than trusting the request.
  foodEntry: {
    findMany: jest.fn(),
  },

  userFCMToken: {
    deleteMany: jest.fn(),
  },
  dailyCalories: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  dailyNutrients: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
};

export default mockPrisma;
