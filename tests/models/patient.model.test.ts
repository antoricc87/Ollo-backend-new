import mockPrisma from "../__mocks__/prismaClient";
import CaloriesService from "../../src/services/calories_tracker/model/calories.model";
import bcrypt from "bcryptjs";
import * as authToken from "../../src/utils/auth_token";
import { signJWT, updateUserToken } from "../../src/utils/auth_token";
import {
  createPatientSummary,
  checkExistingPatient,
  createPatientMobile,
  deletePatientById,
  getPatientById,
  updatePatientPassword,
  updatePatient,
} from "../../src/services/patient/model/patient.model";

// Mock the Prisma client after imports, using the path to your prisma client
jest.mock("../../src/utility/prismaClient", () => ({
  __esModule: true,
  default: {
    ...mockPrisma,
  },
}));
jest.mock("../../src/utils/auth_token", () => ({
  signJWT: jest.fn(),
  updateUserToken: jest.fn(),
}));
jest.mock("bcryptjs", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));
jest.mock("../../src/services/calories_tracker/model/calories.model", () => ({
  createFoodTracker: jest.fn(),
}));
jest.mock("../../src/services/patient/model/patient.model", () => ({
  ...jest.requireActual("../../src/services/patient/model/patient.model"),
  getPatientById: jest.fn(),
}));

describe("createPatientSummary", () => {
  it("should create a new patient summary", async () => {
    const patientId = "patient123";
    const patientSummaryData = {
      id: "summary123",
      patientId: patientId,
    };

    mockPrisma.patientSummary.create.mockResolvedValue(patientSummaryData);

    const result = await createPatientSummary(patientId);

    expect(result).toEqual(patientSummaryData);

    expect(mockPrisma.patientSummary.create).toHaveBeenCalledWith({
      data: {
        patient: {
          connect: { id: patientId },
        },
        nutrition: {
          create: {
            foodIntollerances: [],
            foodAllergies: [],
            foodILike: [],
            foodIDontLike: [],
            foodsToAvoid: [],
            foodsToIncrease: [],
          },
        },
        exercise: {
          create: {
            frequency: "",
            preferences: [],
          },
        },
      },
    });
  });

  it("should log an error if patient summary creation fails", async () => {
    const patientId = "patient456";
    const errorMessage = "Creation failed";

    mockPrisma.patientSummary.create.mockRejectedValue(new Error(errorMessage));

    await expect(createPatientSummary(patientId)).rejects.toThrow(errorMessage);
  });
});

describe("checkExistingPatient", () => {
  it("should return a patient if they exist", async () => {
    const email = "existing.patient@example.com";
    const patientData = {
      id: "patient123",
      firstName: "Existing",
      lastName: "Patient",
      email: email,
    };

    mockPrisma.patient.findUnique.mockResolvedValue(patientData);

    const result = await checkExistingPatient(email);

    expect(result).toEqual(patientData);
    expect(mockPrisma.patient.findUnique).toHaveBeenCalledWith({
      where: { email: email },
    });
  });

  it("should return null if the patient does not exist", async () => {
    const email = "nonexistent.patient@example.com";

    mockPrisma.patient.findUnique.mockResolvedValue(null);

    const result = await checkExistingPatient(email);

    expect(result).toBeNull();
    expect(mockPrisma.patient.findUnique).toHaveBeenCalledWith({
      where: { email: email },
    });
  });

  it("should throw an error if there is a problem fetching the patient", async () => {
    const email = "error.patient@example.com";
    const errorMessage = "Database error";

    mockPrisma.patient.findUnique.mockRejectedValue(new Error(errorMessage));

    await expect(checkExistingPatient(email)).rejects.toThrow(errorMessage);
  });
});

describe("deletePatientById", () => {
  it("should delete a patient and all related data", async () => {
    const patientId = "patient123";

    mockPrisma.patient.delete.mockResolvedValue({ success: true });

    const result = await deletePatientById(patientId);

    expect(result).toEqual({ success: true });
    expect(mockPrisma.patient.delete).toHaveBeenCalledWith({
      where: { id: patientId },
    });
  });

  it("should throw an error if deletion fails", async () => {
    const patientId = "patient123";

    mockPrisma.patient.delete.mockRejectedValue(new Error("Deletion failed"));

    await expect(deletePatientById(patientId)).rejects.toThrow(
      "Deletion failed"
    );
  });
});

describe("createPatientMobile", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should create a new patient with a hashed password, generate a token, and update the database", async () => {
    const patientData = {
      firstName: "John",
      lastName: "Doe",
      email: "john.doe@example.com",
      password: "password123",
      doctorId: "doctor123",
    };

    const hashedPassword = "hashed_password";
    const token = "mock_token";

    // Mock bcrypt.hash to return a hashed password
    (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);

    // Mock Prisma client to return the patient data
    const createdPatient = {
      id: "patient123",
      ...patientData,
      password: hashedPassword,
    };
    mockPrisma.patient.create.mockResolvedValue(createdPatient);

    // Mock signJWT to return a token
    (authToken.signJWT as jest.Mock).mockResolvedValue(token);

    // Mock updateUserToken and CaloriesService.createFoodTracker
    (authToken.updateUserToken as jest.Mock).mockResolvedValue(undefined);
    (CaloriesService.createFoodTracker as jest.Mock).mockResolvedValue(
      undefined
    );

    const result = await createPatientMobile(patientData);

    expect(bcrypt.hash).toHaveBeenCalledWith(patientData.password, 10);
    expect(mockPrisma.patient.create).toHaveBeenCalledWith({
      data: { ...patientData, password: hashedPassword },
    });
    expect(authToken.signJWT).toHaveBeenCalledWith({
      user: { id: "patient123" },
    });
    expect(authToken.updateUserToken).toHaveBeenCalledWith("patient123", token);
    expect(CaloriesService.createFoodTracker).toHaveBeenCalledWith(
      "patient123"
    );
    expect(result).toEqual({ ...createdPatient, token });
  });

  it("should create a new patient without a password, generate a token, and update the database", async () => {
    const patientData = {
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.doe@example.com",
      doctorId: "doctor456",
    };

    const token = "mock_token";

    // Mock Prisma client to return the patient data
    const createdPatient = { id: "patient456", ...patientData };
    mockPrisma.patient.create.mockResolvedValue(createdPatient);

    // Mock signJWT to return a token
    (authToken.signJWT as jest.Mock).mockResolvedValue(token);

    // Mock updateUserToken and CaloriesService.createFoodTracker
    (authToken.updateUserToken as jest.Mock).mockResolvedValue(undefined);
    (CaloriesService.createFoodTracker as jest.Mock).mockResolvedValue(
      undefined
    );

    const result = await createPatientMobile(patientData);

    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(mockPrisma.patient.create).toHaveBeenCalledWith({
      data: patientData,
    });
    expect(authToken.signJWT).toHaveBeenCalledWith({
      user: { id: "patient456" },
    });
    expect(authToken.updateUserToken).toHaveBeenCalledWith("patient456", token);
    expect(CaloriesService.createFoodTracker).toHaveBeenCalledWith(
      "patient456"
    );
    expect(result).toEqual({ ...createdPatient, token });
  });

  it("should throw an error if patient creation fails", async () => {
    const patientData = {
      firstName: "Jake",
      lastName: "Smith",
      email: "jake.smith@example.com",
      password: "password456",
      doctorId: "doctor789",
    };

    // Mock Prisma client to throw an error
    mockPrisma.patient.create.mockRejectedValue(new Error("Creation failed"));

    await expect(createPatientMobile(patientData)).rejects.toThrow(
      "Failed to create patient"
    );

    expect(mockPrisma.patient.create).toHaveBeenCalledWith({
      data: expect.any(Object), // Ensure that the function tried to create a patient
    });
    expect(bcrypt.hash).toHaveBeenCalledWith(patientData.password, 10);
    expect(authToken.signJWT).not.toHaveBeenCalled();
    expect(authToken.updateUserToken).not.toHaveBeenCalled();
    expect(CaloriesService.createFoodTracker).not.toHaveBeenCalled();
  });

  it("should throw an error if token generation fails", async () => {
    const patientData = {
      firstName: "Mark",
      lastName: "Brown",
      email: "mark.brown@example.com",
      password: "password789",
      doctorId: "doctor999",
    };

    const hashedPassword = "hashed_password";

    // Mock bcrypt.hash to return a hashed password
    (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);

    // Mock Prisma client to return the patient data
    const createdPatient = {
      id: "patient789",
      ...patientData,
      password: hashedPassword,
    };
    mockPrisma.patient.create.mockResolvedValue(createdPatient);

    // Mock signJWT to throw an error
    (authToken.signJWT as jest.Mock).mockRejectedValue(
      new Error("Token generation failed")
    );

    await expect(createPatientMobile(patientData)).rejects.toThrow(
      "Failed to create patient"
    );

    expect(bcrypt.hash).toHaveBeenCalledWith(patientData.password, 10);
    expect(mockPrisma.patient.create).toHaveBeenCalledWith({
      data: { ...patientData, password: hashedPassword },
    });
    expect(authToken.signJWT).toHaveBeenCalledWith({
      user: { id: "patient789" },
    });
    expect(authToken.updateUserToken).not.toHaveBeenCalled();
    expect(CaloriesService.createFoodTracker).not.toHaveBeenCalled();
  });
});

describe("updatePatientPassword", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should update the patient's password successfully", async () => {
    const patientId = "patient123";
    const newPasswordData = { password: "hashed_new_password" };
    const updatedPatient = { id: patientId, ...newPasswordData };

    // Mock the Prisma client response
    mockPrisma.patient.update.mockResolvedValue(updatedPatient);

    const result = await updatePatientPassword(patientId, newPasswordData);

    expect(mockPrisma.patient.update).toHaveBeenCalledWith({
      where: { id: patientId },
      data: newPasswordData,
    });
    expect(result).toEqual(updatedPatient);
  });

  it("should throw an error if updating the password fails", async () => {
    const patientId = "patient123";
    const newPasswordData = { password: "hashed_new_password" };
    const errorMessage = "Failed to update password";

    // Mock the Prisma client to throw an error
    mockPrisma.patient.update.mockRejectedValue(new Error(errorMessage));

    const result = await updatePatientPassword(patientId, newPasswordData);

    expect(mockPrisma.patient.update).toHaveBeenCalledWith({
      where: { id: patientId },
      data: newPasswordData,
    });
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe(errorMessage);
  });
});

// describe("updatePatient", () => {
//   it("should update the patient and return updated data with the token", async () => {
//     const patientId = "patient123";
//     const updateData = {
//       firstName: "UpdatedName",
//       lastName: "UpdatedLastName",
//     };
//     const updatedUser = { id: patientId, ...updateData };
//     const token = { token: "mock_token" };
//     const patientDetails = { id: patientId, ...updateData };

//     // Mock Prisma client and dependencies
//     mockPrisma.patient.update.mockResolvedValue(updatedUser);
//     mockPrisma.userToken.findFirst.mockResolvedValue(token);

//     // Mock `getPatientById`
//     (getPatientById as jest.Mock).mockResolvedValue(patientDetails);

//     const result = await updatePatient(patientId, updateData);

//     expect(mockPrisma.patient.update).toHaveBeenCalledWith({
//       where: { id: patientId },
//       data: updateData,
//     });
//     expect(mockPrisma.userToken.findFirst).toHaveBeenCalledWith({
//       where: { userId: patientId },
//     });
//     expect(getPatientById).toHaveBeenCalledWith(patientId);
//     expect(result).toEqual({ ...patientDetails, token: token.token });
//   });

//   it("should handle the case where no token is found", async () => {
//     const patientId = "patient123";
//     const updateData = { firstName: "UpdatedName" };
//     const updatedUser = { id: patientId, ...updateData };
//     const patientDetails = { id: patientId, ...updateData };

//     // Mock Prisma client and dependencies
//     mockPrisma.patient.update.mockResolvedValue(updatedUser);
//     mockPrisma.userToken.findFirst.mockResolvedValue(null); // No token found

//     // Mock `getPatientById`
//     (getPatientById as jest.Mock).mockResolvedValue(patientDetails);

//     const result = await updatePatient(patientId, updateData);

//     expect(mockPrisma.patient.update).toHaveBeenCalledWith({
//       where: { id: patientId },
//       data: updateData,
//     });
//     expect(mockPrisma.userToken.findFirst).toHaveBeenCalledWith({
//       where: { userId: patientId },
//     });
//     expect(getPatientById).toHaveBeenCalledWith(patientId);
//     expect(result).toEqual({ ...patientDetails, token: undefined });
//   });

//   it("should throw an error if updating the patient fails", async () => {
//     const patientId = "patient123";
//     const updateData = { firstName: "UpdatedName" };
//     const errorMessage = "Failed to update patient";

//     // Mock Prisma client to throw an error
//     mockPrisma.patient.update.mockRejectedValue(new Error(errorMessage));

//     await expect(updatePatient(patientId, updateData)).rejects.toThrow(
//       errorMessage
//     );

//     expect(mockPrisma.patient.update).toHaveBeenCalledWith({
//       where: { id: patientId },
//       data: updateData,
//     });
//   });
// });

// describe("getPatientById", () => {
//   afterEach(() => {
//     jest.clearAllMocks();
//   });

//   it("should fetch a patient with the given ID, including related data", async () => {
//     const patientId = "patient123";
//     const mockPatient = {
//       id: patientId,
//       firstName: "John",
//       lastName: "Doe",
//       patientSummary: {
//         allergies: [{ allergy: { substance: "Pollen" } }],
//         conditions: [{ condition: { name: "Asthma" } }],
//         medications: [{ medication: { name: "Inhaler" } }],
//         procedures: [{ procedure: { name: "Bronchoscopy" } }],
//         labResults: [{ labResult: { testType: "Blood Test" } }],
//         exercise: { frequency: "Daily", preferences: ["Running"] },
//         nutrition: { foodILike: ["Apples"], foodIDontLike: ["Bananas"] },
//         vitals: { weight: 70, height: 175 },
//       },
//     };

//     mockPrisma.patient.findUnique.mockResolvedValue(mockPatient); // Ensure resolved value

//     const result = await getPatientById(patientId);

//     expect(mockPrisma.patient.findUnique).toHaveBeenCalledWith({
//       where: { id: patientId },
//       include: {
//         patientSummary: {
//           include: {
//             allergies: { include: { allergy: true } },
//             conditions: { include: { condition: true } },
//             medications: { include: { medication: true } },
//             procedures: { include: { procedure: true } },
//             labResults: { include: { labResult: true } },
//             exercise: true,
//             nutrition: true,
//             vitals: true,
//           },
//         },
//       },
//     });

//     expect(result).toEqual(mockPatient); // Ensure the correct data is returned
//   });

//   it("should throw an error if no patient is found with the given ID", async () => {
//     const patientId = "nonexistentId";

//     mockPrisma.patient.findUnique.mockResolvedValue(null); // Simulate not found

//     await expect(getPatientById(patientId)).rejects.toThrow(
//       `Patient with ID ${patientId} not found`
//     );

//     expect(mockPrisma.patient.findUnique).toHaveBeenCalledWith({
//       where: { id: patientId },
//       include: expect.any(Object), // Ensure structure is correct
//     });
//   });

//   it("should throw an error if Prisma throws an unexpected error", async () => {
//     const patientId = "patient123";
//     const errorMessage = "Database connection failed";

//     mockPrisma.patient.findUnique.mockRejectedValue(new Error(errorMessage)); // Simulate Prisma error

//     await expect(getPatientById(patientId)).rejects.toThrow(errorMessage);

//     expect(mockPrisma.patient.findUnique).toHaveBeenCalledWith({
//       where: { id: patientId },
//       include: expect.any(Object),
//     });
//   });
// });
