import prisma from "../../../utility/prismaClient";
import { Prisma } from "@prisma/client";
import {
  BiologicalAgeData,
  CVRiskData,
  DiabeteRiskData,
  PatientSummary,
} from "../../../types";
import {
  getUserToken,
  signJWT,
  updateUserToken,
} from "../../../utils/auth_token";
import bcrypt from "bcryptjs";
import CaloriesService from "../../calories_tracker/model/calories.model";
import WeightService from "../../weight_tracker/model/weight.model";
import GlucoseService from "../../glucose_tracker/model/glucose.model";
import BPService from "../../bp_tracker/model/bloodpressure.model";
import BFPService from "../../bodyFatPercentage/model/bfp.model";
import { calculateDiabetesRisk } from "../../../utils/risks_calculation_bio_age/calculateDiabetesRisk";
import {
  calculateCVRisk,
  calculateUserRiskScore,
} from "../../../utils/risks_calculation_bio_age/calculateCVRisk";
import { calculatePhenotypicAge } from "../../../utils/risks_calculation_bio_age/calculateBioAge";
import { calculateAgeFromDob } from "../../../utils/calculateAgefromDob";
import { mapLabResults } from "../../../utils/mapLabResult";
import { getWeeklyNutritionOverview } from "../../../utility/nutrition/use_nutrition_utility";

// Helper function to generate sub-account email
const generateSubAccountEmail = async (
  parentEmail: string
): Promise<string> => {
  const baseEmail = parentEmail.split("@")[0];
  const domain = parentEmail.split("@")[1];

  let counter = 1;
  let subAccountEmail = `${baseEmail}.subaccount${counter}@${domain}`;

  // Check if email already exists and increment counter
  while (
    await prisma.patient.findUnique({ where: { email: subAccountEmail } })
  ) {
    counter++;
    subAccountEmail = `${baseEmail}.subaccount${counter}@${domain}`;
  }

  return subAccountEmail;
};
//create patient
export const createPatient = async (patientData: any) => {
  try {
    let updatedPatientData;
    if (patientData.password) {
      const saltRounds = 10;
      const salt = await bcrypt.genSalt(saltRounds);
      const hashedPassword = await bcrypt.hash(patientData.password, salt);
      updatedPatientData = {
        ...patientData,
        password: hashedPassword,
      };
    } else {
      updatedPatientData = {
        ...patientData,
      };
    }
    const patient = await prisma.patient.create({ data: updatedPatientData });
    if (patient) return patient;
  } catch (error: any) {
    console.error("Something went wrong creating the patient", error);
    throw error;
  }
};

// Create sub-account
export const createSubAccount = async (
  subAccountData: any,
  parentPatientId: string
) => {
  try {
    // Get parent patient to generate email
    const parentPatient = await prisma.patient.findUnique({
      where: { id: parentPatientId },
    });

    if (!parentPatient) {
      throw new Error("Parent patient not found");
    }

    // Generate unique email for sub-account
    const subAccountEmail = await generateSubAccountEmail(parentPatient.email);

    // Prepare sub-account data (no password needed)
    const updatedSubAccountData = {
      ...subAccountData,
      email: subAccountEmail,
      subAccountOf: parentPatientId,
    };

    // Create sub-account
    const subAccount = await prisma.patient.create({
      data: updatedSubAccountData,
    });

    if (subAccount) {
      // Create all necessary trackers for sub-account
      await CaloriesService.createTracker(subAccount.id);
      await CaloriesService.createFoodTracker(subAccount.id);
      await WeightService.createMainWeightTracker(subAccount.id);
      await BFPService.createMainBFPTracker(subAccount.id);
      await GlucoseService.findOrCreateMainGlucoseTracker(subAccount.id);
      await BPService.findOrCreateMainBPTracker(subAccount.id);

      return subAccount;
    }
  } catch (error: any) {
    console.error("Something went wrong creating the sub-account", error);
    throw error;
  }
};

// Get all sub-accounts of a patient
export const getSubAccounts = async (parentPatientId: string) => {
  try {
    let subAccounts = await prisma.patient.findMany({
      where: { subAccountOf: parentPatientId },
      include: {
        parentPatient: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
    for (let account of subAccounts) {
      const age = calculateAgeFromDob(account.dob);
      const nutritionOverview = await getWeeklyNutritionOverview(
        account.id,
        age
      );
      subAccounts = subAccounts.map((a) =>
        a.id === account.id ? { ...a, nutritionOverview } : a
      );
    }
    return subAccounts;
  } catch (error: any) {
    console.error("Error fetching sub-accounts", error);
    throw error;
  }
};

export const getExistingSubAccount = async (whereClause: object) => {
  try {
    return await prisma.patient.findFirst({
      where: whereClause,
    });
  } catch (error: unknown) {
    console.error("Error fetching existing sub account", error);
    throw error;
  }
};

// Get parent patient of a sub-account
export const getParentPatient = async (subAccountId: string) => {
  try {
    const subAccount = await prisma.patient.findUnique({
      where: { id: subAccountId },
      include: {
        parentPatient: true,
      },
    });
    return subAccount?.parentPatient;
  } catch (error: any) {
    console.error("Error fetching parent patient", error);
    throw error;
  }
};

//create patient from mobile

export const createPatientMobile = async (patientData: any) => {
  try {
    // Hash the password if it exists
    const updatedPatientData = patientData.password
      ? {
          ...patientData,
          password: await bcrypt.hash(patientData.password, 10),
        }
      : { ...patientData };

    // Create the patient
    const patient = await prisma.patient.create({ data: updatedPatientData });

    if (!patient) {
      throw new Error("Patient creation failed.");
    }

    // Generate JWT token
    const token = await signJWT({ user: { id: patient.id } });

    // Update token in the database
    await updateUserToken(patient.id, token);
    await CaloriesService.createTracker(patient.id);
    await CaloriesService.createFoodTracker(patient.id);
    //create weight tracker
    await WeightService.createMainWeightTracker(patient.id);
    //create bfp tracker
    await BFPService.createMainBFPTracker(patient.id);
    //create glucose tracker
    await GlucoseService.findOrCreateMainGlucoseTracker(patient.id);
    //create blood pressure tracker
    await BPService.findOrCreateMainBPTracker(patient.id);
    // Return patient data with the token
    return { ...patient, token };
  } catch (error: any) {
    console.error("Error creating patient:", error.message);
    throw new Error("Failed to create patient.");
  }
};
// delete patient and all related data
export const deletePatientById = async (patientId: string) => {
  try {
    // FIRST: Recursively delete all subaccounts (this ensures their data is cleaned up too)
    const subAccounts = await prisma.patient.findMany({
      where: { subAccountOf: patientId },
      select: { id: true },
    });

    // Recursively delete each subaccount and all their associated data
    for (const subAccount of subAccounts) {
      await deletePatientById(subAccount.id);
    }

    // NOW delete the parent patient's data...

    // Delete related VitalsSummary
    await prisma.vitalsSummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });

    // Delete related Lab results
    // const labs = await prisma.labResultSummary.findMany({
    //   where: { patientSummary: { patientId: patientId } },
    // });
    // if (labs && labs.length > 0) {
    //   labs.forEach(async (lab) => {
    //     await prisma.labResult.delete({
    //       where: { id: lab.labResultId },
    //     });
    //   });
    // }
    await prisma.labResultSummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });

    // Delete related ProcedureSummary
    const procedures = await prisma.procedureSummary.findMany({
      where: { patientSummary: { patientId: patientId } },
    });
    if (procedures && procedures.length > 0) {
      procedures.forEach(async (procedure) => {
        await prisma.procedure.delete({
          where: { id: procedure.procedureId },
        });
      });
    }

    await prisma.procedureSummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });

    // Delete related MedicationSummary
    const medications = await prisma.medicationSummary.findMany({
      where: { patientSummary: { patientId: patientId } },
    });
    if (medications && medications.length > 0) {
      medications.forEach(async (medication) => {
        await prisma.medication.delete({
          where: { id: medication.medicationId },
        });
      });
    }

    await prisma.medicationSummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });

    // Delete related ConditionSummary
    const conditions = await prisma.conditionSummary.findMany({
      where: { patientSummary: { patientId: patientId } },
    });
    if (conditions && conditions.length > 0) {
      conditions.forEach(async (condition) => {
        await prisma.condition.delete({
          where: { id: condition.conditionId },
        });
      });
    }

    await prisma.conditionSummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });

    // Delete related AllergySummary
    const allergies = await prisma.allergySummary.findMany({
      where: { patientSummary: { patientId: patientId } },
    });
    if (allergies && allergies.length > 0) {
      allergies.forEach(async (allergy) => {
        await prisma.allergy.delete({
          where: { id: allergy.allergyId },
        });
      });
    }

    await prisma.allergySummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });

    // Delete related ExerciseSummary
    await prisma.exerciseSummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });
    // Delete related FamilyHistorySummary
    await prisma.familyHistorySummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });
    // Delete related NutritionSummary
    await prisma.nutritionSummary.deleteMany({
      where: { patientSummary: { patientId: patientId } },
    });

    // Delete related PatientSummary
    await prisma.patientSummary.deleteMany({
      where: { patientId: patientId },
    });

    // Delete related CaloriesTracker
    await prisma.caloriesTracker.deleteMany({
      where: { userId: patientId },
    });

    // Delete related Exercises Tracker
    await prisma.exerciseTracker.deleteMany({
      where: { userId: patientId },
    });

    // Delete related Weight Tracker
    await prisma.weightTracker.deleteMany({
      where: { userId: patientId },
    });
    // Delete related glucose Trackers
    await prisma.glucoseTracker.deleteMany({
      where: { userId: patientId },
    });
    //Delete related bfp trackers
    await prisma.bFPTracker.deleteMany({
      where: { userId: patientId },
    });
    //Delete blood pressure tracker
    await prisma.bloodPressureTracker.deleteMany({
      where: { userId: patientId },
    });
    // Delete Fav Meals
    await prisma.favMeal.deleteMany({
      where: { userId: patientId },
    });
    // Delete related FoodTracker
    await prisma.foodTracker.deleteMany({
      where: { userId: patientId },
    });

    //delete related favorites food
    await prisma.favFood.deleteMany({
      where: { patientId: patientId },
    });

    // Delete related MacroNutrientsTracker
    await prisma.macroNutrientsTracker.deleteMany({
      where: { userId: patientId },
    });
    // delete tokens
    await prisma.userToken.deleteMany({
      where: { userId: patientId },
    });
    //delete FCM Tokens
    await prisma.userFCMToken.deleteMany({
      where: { userId: patientId },
    });

    // Finally, delete the patient itself
    await prisma.patient.delete({
      where: { id: patientId },
    });

    return { success: true };
  } catch (error: unknown) {
    console.error("Error deleting the patient", error);
    throw error;
  }
};
//create new PatientSummary
export const createPatientSummary = async (patientId: string) => {
  try {
    const newPatientSummary = await prisma.patientSummary.create({
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

    return newPatientSummary;
  } catch (error) {
    console.error("Error creating patient summary", error);
    throw error;
  }
};

//check if user is registered
export const checkExistingPatient = async (email: string) => {
  try {
    return await prisma.patient.findUnique({
      where: { email: email },
    });
  } catch (error: any) {
    console.error("Something went wrong fetching the user");
    throw error;
  }
};

//patient login
export const patientLogin = async (email: string, password: string) => {
  try {
    const patient = await checkExistingPatient(email);
    if (!patient) {
      console.log("Account not found");
      throw new Error("There is no account with this email");
    }
    const matchingPassword = await bcrypt.compare(
      password,
      patient.password || ""
    );
    if (!matchingPassword) {
      console.log("Wrong password");
      throw new Error("Incorrect password");
    }
    const payload = { user: { id: patient.id } };
    const token = await signJWT(payload);
    await updateUserToken(patient.id, token);
    const patientDetails = await getPatientById(patient.id);
    const patientData = { ...patientDetails, token: token };
    return patientData;
  } catch (error: any) {
    console.log("Something went wrong logging the user in");
    throw new Error(error.message);
  }
};
//fetch all patients
export const fetchAllPatients = async (where: object) => {
  try {
    const patients = await prisma.patient.findMany({
      where: where,
      include: {
        healthCheckUp: {
          take: 1,
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });
    if (patients) return patients;
  } catch (error: any) {
    console.error("Something went  wrong fetching the patients");
    throw error;
  }
};
//update patient password
export const updatePatientPassword = async (id: string, data: object) => {
  try {
    return await prisma.patient.update({
      where: { id: id },
      data: data,
    });
  } catch (error: any) {
    console.error("Something went wrong updating the user password");
    return error;
  }
};
// // update patient
export const updatePatient = async (id: string, data: object) => {
  try {
    //update patient
    const updatedUser = await prisma.patient.update({
      where: { id: id },
      data: data,
    });
    const token = await prisma.userToken.findFirst({ where: { userId: id } });
    //fetch updated patient with all related fields
    const patient = await getPatientById(id);
    const userData = { ...patient, token: token?.token };
    return userData;
  } catch (error: any) {
    console.error("Something went wrong updating the user");
    throw error;
  }
};

// get patient by id
export const getPatientById = async (id: string) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: id },
      include: {
        patientSummary: {
          include: {
            allergies: {
              include: {
                allergy: true,
              },
            },
            conditions: {
              include: {
                condition: true,
              },
            },
            medications: {
              include: {
                medication: true,
              },
            },
            procedures: {
              include: {
                procedure: true,
              },
            },
            labResults: {
              orderBy: {
                createdAt: "desc",
              },
              include: {
                // labResult: true,
                labResults: true,
              },
            },
            exercise: true,
            nutrition: true,
            vitals: true,
            familyHistory: true,
          },
        },
        healthCheckUp: {
          take: 1,
          orderBy: {
            createdAt: "desc",
          },
        },
        instacartPreferences: true,
        dexcomToken: true,
      },
    });

    if (!patient) {
      console.error(`No patient found with ID: ${id}`);
      throw new Error(`Patient with ID ${id} not found`);
    }
    const token = await prisma.userToken.findUnique({
      where: {
        userId: patient.id,
      },
    });
    const isSubAccount = patient.subAccountOf;
    if (isSubAccount) {
      return patient;
    }
    const patientWithToken = {
      ...patient,
      token: token.token,
    };
    return patientWithToken;
  } catch (error: any) {
    console.error("Error details:", error); // Log full error details for more context
    throw error;
  }
};

//create visit
export const createVisit = async (data: any) => {
  try {
    const visit = await prisma.visit.create({
      data: data,
    });
    if (visit) return visit;
  } catch (error: unknown) {
    console.error("Error creating the visit", error);
    throw error;
  }
};
//update visit
export const updateVisit = async (id: string, data: object) => {
  try {
    return await prisma.visit.update({
      where: { id: id },
      data: data,
    });
  } catch (error: any) {
    console.error("Something went wrong updating the visit");
    return error;
  }
};

// Create a new referral
export const createReferral = async (data: Prisma.ReferralCreateInput) => {
  try {
    return await prisma.referral.create({
      data: data,
    });
  } catch (error: any) {
    console.error("Something went wrong creating the referral");
    return error;
  }
};

// Create a new pre-auth
export const createPreAuth = async (data: Prisma.PreAuthCreateInput) => {
  try {
    return await prisma.preAuth.create({
      data: data,
    });
  } catch (error: any) {
    console.error("Something went wrong creating the pre-auth");
    return error;
  }
};

// Get all referrals for a patient
export const getReferrals = async (patientId: string) => {
  try {
    return await prisma.referral.findMany({
      where: { patientId: patientId },
    });
  } catch (error: any) {
    console.error("Something went wrong fetching referrals");
    return error;
  }
};

// Get all pre-auths for a patient
export const getPreAuths = async (patientId: string) => {
  try {
    return await prisma.preAuth.findMany({
      where: { patientId: patientId },
    });
  } catch (error: any) {
    console.error("Something went wrong fetching pre-auths");
    return error;
  }
};

// update patient sections Allergies,Conditions and Medications
const updateSection = async (
  section: keyof PatientSummary,
  data: any,
  patientId: string,
  currentSummary: any
) => {
  try {
    // if (section === "Allergies" || section === "Conditions") {
    const updatedSection = data;
    // Update the patient with the new summary
    const updatedPatient = await prisma.patient.update({
      where: { id: patientId },
      data: {
        summary: {
          ...currentSummary,
          [section]: updatedSection,
        },
      },
    });
    return updatedPatient;
    // }
  } catch (error: any) {
    console.error("Error occurred during the update");
    throw error;
  }
};
export const updatePatientSection = async (
  patientId: string,
  section: keyof PatientSummary,
  data: object[]
) => {
  console.log(data);
  try {
    // Fetch the existing patient summary
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        summary: true,
      },
    });

    if (!patient) {
      throw new Error("Patient not found");
    }

    // Cast summary to PatientSummary type
    const currentSummary: PatientSummary =
      patient.summary && typeof patient.summary === "object"
        ? (patient.summary as PatientSummary)
        : {};

    const updatedPatient = await updateSection(
      section,
      data,
      patientId,
      currentSummary
    );
    const token = await getUserToken(patientId);
    const patientData = { ...updatedPatient, token: token };
    return patientData;
  } catch (error: any) {
    console.error("Error updating patient section", error);
    throw new Error("Error updating patient section");
  }
};

// Helper function to handle medications
export async function handleMedications(
  patientSummaryId: string,
  data: Array<{ name: string; dosage: string; status: string }>
) {
  const medPromises = data.map(async (d) => {
    // 1) ensure the Medication master record exists
    let existingMed = await prisma.medication.findUnique({
      where: { name: d.name },
    });
    if (!existingMed) {
      existingMed = await prisma.medication.create({
        data: {
          name: d.name,
          dosage: d.dosage,
          status: d.status,
        },
      });
    }

    // 2) check whether a summary link already exists
    const existingSummary = await prisma.medicationSummary.findFirst({
      where: {
        patientSummaryId,
        medicationId: existingMed.id,
      },
    });

    // 3) if it doesn’t, return the “create” payload; otherwise return null
    if (!existingSummary) {
      return { medicationId: existingMed.id };
    }
    return null;
  });

  // 4) run them all and filter out the nulls
  return (await Promise.all(medPromises)).filter(
    (summary): summary is { medicationId: string } => summary !== null
  );
}

// Helper function to handle allergies
async function handleAllergies(patientSummaryId: string, data: any) {
  const allergyPromises = data.map(async (allergy: any) => {
    let existingAllergy = await prisma.allergy.findUnique({
      where: { substance: allergy.substance },
    });

    if (!existingAllergy) {
      existingAllergy = await prisma.allergy.create({
        data: {
          substance: allergy.substance,
          reactions: allergy.reactions || [],
          status: allergy.status,
        },
      });
    }

    const existingSummary = await prisma.allergySummary.findFirst({
      where: {
        patientSummaryId: patientSummaryId,
        allergyId: existingAllergy.id,
      },
    });

    if (!existingSummary) {
      return {
        allergyId: existingAllergy.id,
      };
    }
    return null;
  });

  return (await Promise.all(allergyPromises)).filter(
    (summary) => summary !== null
  );
}

// Helper function to handle conditions
async function handleConditions(patientSummaryId: string, data: any) {
  const conditionPromises = data.map(async (condition: any) => {
    let existingCondition = await prisma.condition.findUnique({
      where: { name: condition.name },
    });

    if (!existingCondition) {
      existingCondition = await prisma.condition.create({
        data: {
          name: condition.name,
          clinicalStatus: condition.clinicalStatus,
          verificationStatus: condition.verificationStatus,
          onset: condition.onset,
        },
      });
    }

    const existingSummary = await prisma.conditionSummary.findFirst({
      where: {
        patientSummaryId: patientSummaryId,
        conditionId: existingCondition.id,
      },
    });

    if (!existingSummary) {
      return {
        conditionId: existingCondition.id,
      };
    }
    return null;
  });

  return (await Promise.all(conditionPromises)).filter(
    (summary) => summary !== null
  );
}

// Helper function to handle procedures
async function handleProcedures(patientSummaryId: string, data: any) {
  const procedurePromises = data.map(async (procedure: any) => {
    let existingProcedure = await prisma.procedure.findUnique({
      where: { name: procedure.name },
    });

    if (!existingProcedure) {
      existingProcedure = await prisma.procedure.create({
        data: {
          name: procedure.name,
          period: procedure.period,
        },
      });
    }

    const existingSummary = await prisma.procedureSummary.findFirst({
      where: {
        patientSummaryId: patientSummaryId,
        procedureId: existingProcedure.id,
      },
    });

    if (!existingSummary) {
      return {
        procedureId: existingProcedure.id,
      };
    }
    return null;
  });

  return (await Promise.all(procedurePromises)).filter(
    (summary) => summary !== null
  );
}
// Helper function to handle exercise
async function handleExercise(patientSummaryId: string, data: any) {
  const exercise = data[0];
  // Check if an exercise entry already exists for this patientSummaryId
  const existingExercise = await prisma.exerciseSummary.findUnique({
    where: { patientSummaryId },
  });

  if (!existingExercise) {
    return {
      frequency: exercise.frequency,
      preferences: exercise.preferences || [],
    };
  } else {
    // Update the existing exercise data
    await prisma.exerciseSummary.update({
      where: { patientSummaryId },
      data: {
        frequency: exercise.frequency,
        preferences: exercise.preferences || [],
      },
    });
  }

  return null; // Return null if the exercise data was updated to avoid duplication.
}

// Helper function to handle nutrition
async function handleNutrition(patientSummaryId: string, data: any) {
  const nutrition = data[0];
  const existingNutrition = await prisma.nutritionSummary.findUnique({
    where: { patientSummaryId },
  });

  if (!existingNutrition) {
    return {
      foodIntollerances: nutrition.foodIntollerances || [],
      foodAllergies: nutrition.foodAllergies || [],
      foodIDontLike: nutrition.foodIDontLike || [],
      foodILike: nutrition.foodILike || [],
      dietaryPreferences: nutrition.dietaryPreferences || [],
    };
  } else {
    // Update the existing nutrition data
    await prisma.nutritionSummary.update({
      where: { patientSummaryId },
      data: {
        foodIntollerances: nutrition.foodIntollerances,
        foodAllergies: nutrition.foodAllergies,
        foodIDontLike: nutrition.foodIDontLike,
        foodILike: nutrition.foodILike,
        dietaryPreferences: nutrition.dietaryPreferences || [],
      },
    });
  }

  return null; // Return null if the nutrition data was updated to avoid duplication.
}

async function handleFoods(
  patientSummaryId: string,
  newFoodsToAvoid: string[],
  newFoodsToIncrease: string[]
) {
  try {
    // Update only the foodsToAvoid and foodsToIncrease fields
    await prisma.nutritionSummary.update({
      where: { patientSummaryId },
      data: {
        foodsToAvoid: newFoodsToAvoid,
        foodsToIncrease: newFoodsToIncrease,
      },
    });
  } catch (error) {
    console.error("Error updating foods in NutritionSummary:", error);
    throw error;
  }
}

// Helper function to handle vitals
async function handleVitals(patientSummaryId: string, data: any) {
  const vitals = data[0];
  // Check if a vitals entry already exists for this patientSummaryId
  const existingVitals = await prisma.vitalsSummary.findUnique({
    where: { patientSummaryId },
  });

  if (!existingVitals) {
    return vitals;
  } else {
    // Update the existing vitals data
    await prisma.vitalsSummary.update({
      where: { patientSummaryId },
      data: vitals,
    });
  }

  return null; // Return null if the vitals data was updated to avoid duplication.
}
//Helper function to handle family History
async function handleFamilyHistory(patientSummaryId: string, data: any) {
  const history = data[0];
  const existingFamilyHistory = await prisma.familyHistorySummary.findUnique({
    where: { patientSummaryId },
  });
  if (!existingFamilyHistory) {
    return history;
  } else {
    await prisma.familyHistorySummary.update({
      where: { patientSummaryId },
      data: history,
    });
  }
  return null; //return null to avoid data duplicartion
}

export const saveParsedLabData = async (
  // patientSummaryId: string,
  category: string,
  testType: string,
  referenceRange: string,
  isOutOfRange: boolean,
  result: string,
  units: string,
  aboutTestType: string,
  labResultSummaryId: string
) => {
  try {
    const labResult = await prisma.labResult.create({
      data: {
        testType,
        category,
        result,
        referenceRange,
        isOutOfRange,
        units,
        aboutTestType,
        labResultSummaryId,
      },
    });

    return {
      labResult,
      // labResultSummary,
    };
  } catch (error) {
    console.error("Error saving lab data:", error);
    throw new Error("Failed to save lab data.");
  }
};

// Main function to update patient summary section
export const updatePatientSummarySection = async (
  patientId: string,
  section: string,
  data: any
) => {
  try {
    const patientSummary = await prisma.patientSummary.findUnique({
      where: { patientId: patientId },
      include: {
        allergies: true,
        conditions: true,
        medications: true,
        procedures: true,
        labResults: true,
      },
    });

    if (!patientSummary) {
      throw new Error("Patient summary not found");
    }

    let updateData: Prisma.PatientSummaryUpdateInput = {};

    switch (section) {
      case "medications":
        // a) remove all old links
        await prisma.medicationSummary.deleteMany({
          where: { patientSummaryId: patientSummary.id },
        });

        // b) build exactly the summaries you still want
        const medicationSummaries = await handleMedications(
          patientSummary.id,
          data as Array<{ name: string; dosage: string; status: string }>
        );

        if (medicationSummaries.length > 0) {
          updateData = {
            medications: { create: medicationSummaries },
          };
        }
        break;

      case "allergies":
        // delete all prior allergy links
        await prisma.allergySummary.deleteMany({
          where: { patientSummaryId: patientSummary.id },
        });
        // build summaries for each selected allergy (creates master Allergy if needed)
        const allergySummaries = await handleAllergies(patientSummary.id, data);
        if (allergySummaries.length > 0) {
          updateData = {
            allergies: { create: allergySummaries },
          };
        }
        break;

      case "conditions":
        // delete all prior condition links
        await prisma.conditionSummary.deleteMany({
          where: { patientSummaryId: patientSummary.id },
        });
        // build summaries for each selected condition (creates master Condition if needed)
        const conditionSummaries = await handleConditions(
          patientSummary.id,
          data
        );
        if (conditionSummaries.length > 0) {
          updateData = {
            conditions: { create: conditionSummaries },
          };
        }
        break;

      case "procedures":
        const procedureSummaries = await handleProcedures(
          patientSummary.id,
          data
        );
        if (procedureSummaries.length > 0) {
          updateData = { procedures: { create: procedureSummaries } };
        }
        break;

      case "exercise":
        const exerciseData = await handleExercise(patientSummary.id, data);
        if (exerciseData) {
          updateData = { exercise: { create: exerciseData } };
        }
        break;

      case "nutrition":
        const nutritionData = await handleNutrition(patientSummary.id, data);
        if (nutritionData) {
          updateData = { nutrition: { create: nutritionData } };
        }
        break;

      case "vitals":
        const vitalsData = await handleVitals(patientSummary.id, data);
        if (vitalsData) {
          updateData = { vitals: { create: vitalsData } };
        }
        break;

      case "foodsRec":
        await handleFoods(
          patientSummary.id,
          data[0].foodsToAvoid,
          data[0].foodsToIncrease
        );
        break;

      case "caloricAmount":
        const caloricAmount = data[0].caloricAmount;
        if (caloricAmount) {
          updateData = { caloricAmount: caloricAmount };
        }
        break;

      case "labs":
        const patientSummaryId = patientSummary.id;
        const labSummary = await prisma.labResultSummary.create({
          data: {
            patientSummaryId,
            labReport: data.labReport,
            recommendations: data.recommendations,
          },
        });
        for (const lab of data.labResults) {
          await saveParsedLabData(
            // patientSummary.id,
            lab.category,
            lab.testType,
            lab.referenceRange,
            lab.isOutOfRange,
            lab.result,
            lab.units,
            lab.aboutTestType,
            labSummary.id
          );
        }
        break;

      case "family_history":
        const familyHistory = await handleFamilyHistory(
          patientSummary.id,
          data
        );
        if (familyHistory) {
          updateData = { familyHistory: { create: familyHistory } };
        }
        break;

      default:
        throw new Error("Invalid section specified");
    }

    // Only proceed with updating patient summary if updateData contains fields to update
    if (Object.keys(updateData).length > 0) {
      await prisma.patientSummary.update({
        where: { id: patientSummary.id },
        data: updateData,
      });
    }

    // Refresh the patient data
    const updatedPatient = await getPatientById(patientId);
    const token = await getUserToken(patientId);
    return { ...updatedPatient, token };
  } catch (error: any) {
    console.error("Error updating patient summary section", error);
    throw new Error("Error updating patient summary section");
  }
};

export const generateRisksOverviewDatasets = async (patientId: string) => {
  try {
    const patient = await getPatientById(patientId);
    const { patientSummary } = patient;
    if (!patientSummary) {
      throw new Error("Patient summary not found");
    }
    // Calculate age from DOB
    const age = calculateAgeFromDob(patient.dob);
    // Validate vitals data
    if (!patientSummary.vitals?.height || !patientSummary.vitals?.weight) {
      throw new Error(
        "Missing vital information (e.g., blood pressure, height, or weight)."
      );
    }

    const systolicBp = patientSummary.vitals.sBp || 120;
    const diastolicBp = patientSummary.vitals.dBp || 80;
    const height = patientSummary.vitals.height;
    const weight = patientSummary.vitals.weight;
    const gender =
      patient.gender === "male"
        ? "M"
        : patient.gender === "female"
        ? "F"
        : null;

    const { biomarkers, diabetesRiskLabs, cvRiskLabs } = mapLabResults(
      patientSummary.labResults[0]
    );

    const missingDiabetesLabs = Object.keys(diabetesRiskLabs).filter(
      (key) => diabetesRiskLabs[key] === undefined
    );
    const missingCVLabs = Object.keys(cvRiskLabs).filter(
      (key) => cvRiskLabs[key] === undefined
    );
    const missingBiomarkers = Object.keys(biomarkers).filter(
      (key) => biomarkers[key] === undefined
    );

    if (
      missingDiabetesLabs.length > 0 ||
      missingCVLabs.length > 0 ||
      missingBiomarkers.length > 0
    ) {
      throw new Error(
        `Missing lab values: ${
          missingDiabetesLabs.length
            ? `Diabetes Risk Labs - ${missingDiabetesLabs.join(", ")}`
            : ""
        } ${
          missingCVLabs.length
            ? `CV Risk Labs - ${missingCVLabs.join(", ")}`
            : ""
        } ${
          missingBiomarkers.length
            ? `Biomarkers - ${missingBiomarkers.join(", ")}`
            : ""
        }`.trim()
      );
    }

    if (missingBiomarkers.length > 0) {
      throw new Error(`Missing biomarker(s): ${missingBiomarkers.join(", ")}.`);
    }

    // Determine diabetic status based on conditions
    const diabetic = patientSummary.conditions.some((condition) =>
      condition.condition.name.toLowerCase().includes("diabetes")
    );
    const parentalDiabetes =
      patientSummary.familyHistory.historyOfChronicConditions.includes(
        "diabetes"
      );
    const smoker = patientSummary.vitals.isSmoker;
    const hypertensionTreatment = false;
    const diabeteData: DiabeteRiskData = {
      age,
      gender,
      systolicBp,
      diastolicBp,
      hypertensionTreatment,
      height,
      weight,
      hdl: diabetesRiskLabs.hdl,
      triglycerides: diabetesRiskLabs.triglycerides,
      fastingGlucose: diabetesRiskLabs.fastingGlucose,
      parentalDiabetes,
    };
    const cvRiskData: CVRiskData = {
      gender,
      age,
      sbp: systolicBp,
      tcl:
        cvRiskLabs.tcl ||
        cvRiskLabs.ldl + diabetesRiskLabs.hdl + cvRiskLabs.triglycerides / 5,
      hdl: diabetesRiskLabs.hdl,
      smoker,
      diabetic,
      treatmentStatus: hypertensionTreatment ? "treatment" : "noTreatment",
    };
    const biologicalAgeData: BiologicalAgeData = {
      age,
      albumin: biomarkers.albumin,
      creatinine: biomarkers.creatinine,
      glucose: biomarkers.glucose,
      crp: biomarkers.crp || 1,
      rdw: biomarkers.rdw,
      wbc: biomarkers.wbc,
      mcv: biomarkers.mcv,
      lympocyte: biomarkers.lympocyte,
      alkalinePhosphatase: biomarkers.alkalinePhosphatase,
    };
    return {
      biologicalAgeData,
      diabeteData,
      cvRiskData,
    };
  } catch (error: unknown) {
    console.error("Something went wrong creating datasets", error);
    throw error;
  }
};

export const calculatePatientOverview = async (
  diabeteData: DiabeteRiskData,
  cvRiskData: CVRiskData,
  biologicalAgeData: BiologicalAgeData
) => {
  try {
    const diabetesRisk = calculateDiabetesRisk(diabeteData);
    const cvRisk = calculateCVRisk(cvRiskData);
    const biologicalAge = calculatePhenotypicAge(biologicalAgeData);

    return { diabetesRisk, cvRisk, biologicalAge };
  } catch (error: unknown) {
    console.error("Error generating patient overview", error);
    throw error;
  }
};

export const updateInstacartPreferences = async (
  data: any,
  patientId: string
) => {
  try {
    const instacartPreferences = await prisma.instacartPreferences.findUnique({
      where: { patientId: patientId },
    });

    if (!instacartPreferences) {
      return await prisma.instacartPreferences.create({
        data: {
          patientId: patientId,
          retailer_key: data.retailer_key,
          retailer_logo_url: data.retailer_logo_url,
          retailer_name: data.retailer_name,
        },
      });
    }
    return await prisma.instacartPreferences.update({
      where: { id: instacartPreferences.id },
      data: {
        retailer_key: data.retailer_key,
        retailer_logo_url: data.retailer_logo_url,
        retailer_name: data.retailer_name,
      },
    });
  } catch (error: unknown) {
    console.error("Error updating instacart preferences", error);
    throw error;
  }
};

export const fetchPatientLabs = async (patientId: string) => {
  try {
    const patientSummary = await prisma.patientSummary.findUnique({
      where: { patientId: patientId },
    });
    const labResultSummaries = await prisma.labResultSummary.findMany({
      where: { patientSummaryId: patientSummary.id },
      include: {
        labResults: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    if (!labResultSummaries) {
      console.log("Lab result summaries not found");
      return [];
    }
    return labResultSummaries;
  } catch (error: unknown) {
    console.error("Error fetching patient Labs");
    throw error;
  }
};

// ------------------- Patient Insurance Management ------------------- //

export const createPatientInsurance = async ({
  patientId,
  insuranceProvider,
  planType,
  fullPlanName,
  allowsAnyPCP,
}: {
  patientId: string;
  insuranceProvider: string;
  planType: string;
  fullPlanName?: string;
  allowsAnyPCP: boolean;
}) => {
  try {
    const existingInsurance = await prisma.patientInsurance.findUnique({
      where: {
        patientId: patientId,
      },
    });
    if (existingInsurance) {
      const insurance = await prisma.patientInsurance.update({
        where: { patientId: patientId },
        data: {
          insuranceProvider,
          planType,
          fullPlanName,
          allowsAnyPCP,
        },
      });
      return insurance;
    } else {
      const insurance = await prisma.patientInsurance.create({
        data: {
          patient: {
            connect: { id: patientId },
          },
          insuranceProvider,
          planType,
          fullPlanName,
          allowsAnyPCP,
        },
      });
      return insurance;
    }
  } catch (error) {
    console.error("Error creating patient insurance", error);
    throw error;
  }
};

export const fetchPatientInsurances = async (patientId: string) => {
  try {
    const insurances = await prisma.patientInsurance.findMany({
      where: { patientId },
    });
    return insurances;
  } catch (error) {
    console.error("Error fetching patient insurances", error);
    throw error;
  }
};

export const updateInsuranceRecord = async ({
  id,
  insuranceProvider,
  planType,
  fullPlanName,
  allowsAnyPCP,
}: {
  id: string;
  insuranceProvider?: string;
  planType?: string;
  fullPlanName?: string;
  allowsAnyPCP?: boolean;
}) => {
  try {
    const updated = await prisma.patientInsurance.update({
      where: { id },
      data: {
        insuranceProvider,
        planType,
        fullPlanName,
        allowsAnyPCP,
      },
    });
    return updated;
  } catch (error) {
    console.error("Error updating patient insurance", error);
    throw error;
  }
};

export const deleteInsuranceRecord = async (id: string) => {
  try {
    await prisma.patientInsurance.delete({ where: { id } });
    return { success: true };
  } catch (error) {
    console.error("Error deleting patient insurance", error);
    throw error;
  }
};
