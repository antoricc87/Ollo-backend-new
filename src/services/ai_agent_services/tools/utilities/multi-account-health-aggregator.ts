import {
  getPatientById,
  getSubAccounts,
} from "../../../patient/model/patient.model";

export interface AggregatedHealthData {
  allAllergies: string[];
  allConditions: string[];
  allAbnormalLabs: string[];
  combinedNutrition: any;
  parentCalories: number;
  totalAccounts: number;
  familyMembers: Array<{
    name: string;
    id: string;
    caloricAmount: number;
    age?: number;
  }>;
}

/**
 * Aggregates health data from a parent patient and all their subaccounts
 * This is useful for generating meal plans or recommendations that need to
 * consider all family members' dietary restrictions and health conditions
 */
export class MultiAccountHealthAggregator {
  /**
   * Gets aggregated health data from parent patient and all subaccounts
   * @param parentPatientId - The ID of the parent patient
   * @returns Aggregated health data including allergies, conditions, and nutritional preferences
   */
  static async getAggregatedHealthData(
    parentPatientId: string
  ): Promise<AggregatedHealthData> {
    try {
      // Get parent patient data
      const parentPatient = await getPatientById(parentPatientId);
      if (!parentPatient) {
        throw new Error("Parent patient not found");
      }

      // Get all subaccounts
      const subAccounts = await getSubAccounts(parentPatientId);

      // Fetch patient summary data for each subaccount
      const subAccountsWithSummary = await Promise.all(
        subAccounts.map(async (subAccount) => {
          const fullSubAccount = await getPatientById(subAccount.id);
          return fullSubAccount;
        })
      );

      return this.aggregateHealthDataFromAllAccounts(
        parentPatient,
        subAccountsWithSummary
      );
    } catch (error) {
      console.error("Error aggregating health data:", error);
      throw error;
    }
  }

  /**
   * Aggregates health data from parent patient and subaccounts
   * @param parentPatient - The parent patient object
   * @param subAccounts - Array of subaccount patient objects
   * @returns Aggregated health data
   */
  private static aggregateHealthDataFromAllAccounts(
    parentPatient: any,
    subAccounts: any[]
  ): AggregatedHealthData {
    // Collect all allergies from parent and subaccounts
    const allAllergies = new Set<string>();
    const allConditions = new Set<string>();
    const allAbnormalLabs = new Set<string>();
    let combinedNutrition: any = {};
    let parentCalories = 0;
    const familyMembers: Array<{
      name: string;
      id: string;
      caloricAmount: number;
      age?: number;
    }> = [];

    // Process parent patient data
    if (parentPatient.patientSummary) {
      const { nutrition, allergies, conditions, caloricAmount, labResults } =
        parentPatient.patientSummary;

      parentCalories = caloricAmount || 0;
      combinedNutrition = { ...nutrition };

      // Add parent to family members
      familyMembers.push({
        name: `${parentPatient.firstName} ${parentPatient.lastName}`,
        id: parentPatient.id,
        caloricAmount: parentCalories,
        age: parentPatient.dob
          ? this.calculateAge(parentPatient.dob)
          : undefined,
      });

      if (allergies) {
        allergies.forEach((allergy: any) => {
          allAllergies.add(allergy.allergy.substance);
        });
      }

      if (conditions) {
        conditions.forEach((condition: any) => {
          allConditions.add(condition.condition.name);
        });
      }

      if (labResults && labResults[0]?.labResults) {
        labResults[0].labResults
          .filter((lab: any) => lab.isOutOfRange)
          .forEach((lab: any) => {
            allAbnormalLabs.add(lab.testType);
          });
      }
    }

    // Process subaccount data
    for (const subAccount of subAccounts) {
      if (subAccount.patientSummary) {
        const { nutrition, allergies, conditions, labResults, caloricAmount } =
          subAccount.patientSummary;

        // Add subaccount to family members
        familyMembers.push({
          name: `${subAccount.firstName} ${subAccount.lastName}`,
          id: subAccount.id,
          caloricAmount: caloricAmount || 0,
          age: subAccount.dob ? this.calculateAge(subAccount.dob) : undefined,
        });

        // Merge nutrition preferences (parent preferences take precedence)
        if (nutrition) {
          combinedNutrition = { ...combinedNutrition, ...nutrition };
        }

        if (allergies) {
          allergies.forEach((allergy: any) => {
            allAllergies.add(allergy.allergy.substance);
          });
        }

        if (conditions) {
          conditions.forEach((condition: any) => {
            allConditions.add(condition.condition.name);
          });
        }

        if (labResults && labResults[0]?.labResults) {
          labResults[0].labResults
            .filter((lab: any) => lab.isOutOfRange)
            .forEach((lab: any) => {
              allAbnormalLabs.add(lab.testType);
            });
        }
      }
    }

    return {
      allAllergies: Array.from(allAllergies),
      allConditions: Array.from(allConditions),
      allAbnormalLabs: Array.from(allAbnormalLabs),
      combinedNutrition,
      parentCalories,
      totalAccounts: 1 + subAccounts.length,
      familyMembers,
    };
  }

  /**
   * Calculate age from date of birth
   * @param dob - Date of birth
   * @returns Age in years
   */
  private static calculateAge(dob: Date): number {
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }
}

/**
 * Convenience function to get aggregated health data
 * @param parentPatientId - The ID of the parent patient
 * @returns Promise resolving to aggregated health data
 */
export const getAggregatedHealthData = (
  parentPatientId: string
): Promise<AggregatedHealthData> => {
  return MultiAccountHealthAggregator.getAggregatedHealthData(parentPatientId);
};
