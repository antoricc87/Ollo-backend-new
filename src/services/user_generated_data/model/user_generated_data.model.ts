import prisma from "../../../utility/prismaClient";

class UserGeneratedDataService {
  async fetchAdultsMealPlans(patientId: string) {
    try {
      const allGeneratedData = await prisma.userGeneratedData.findMany({
        where: { patientId: patientId, type: "meal_plan" },
      });
      if (allGeneratedData) return allGeneratedData;
    } catch (error: unknown) {
      console.log("Error fetching the data", error);
      throw error;
    }
  }
  async fetchSubAccountMealPlans(patientId: string) {
    try {
      const allGeneratedData = await prisma.userGeneratedData.findMany({
        where: { patientId: patientId, type: "kids_meal_plan" },
      });
      if (allGeneratedData) return allGeneratedData;
    } catch (error: unknown) {
      console.log("Error fetching the data", error);
      throw error;
    }
  }
}

export default new UserGeneratedDataService();
