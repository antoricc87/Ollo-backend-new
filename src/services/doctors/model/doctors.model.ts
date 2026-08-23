import prisma from "../../../utility/prismaClient";
import { getPatientById } from "../../patient/model/patient.model";

class DoctorsService {
  async fetchAllDoctors() {
    try {
      const doctors = await prisma.user.findMany();
      return doctors;
    } catch (error: unknown) {
      console.error("Error fetching doctors", error);
      throw error;
    }
  }
  async fetchDoctorsAndAvailabilities() {
    try {
      const testDoctors = [
        "6835da125f28a90b46935fdf",
        "686527851371d52d14ede8c5",
      ];
      const doctors = await prisma.user.findMany({
        where: {
          id: {
            notIn: testDoctors,
          },
        },
        include: {
          availabilities: {
            include: {
              days: {
                orderBy: {
                  date: "asc",
                },
                include: {
                  slots: {
                    orderBy: {
                      startTime: "asc",
                    },
                  },
                },
              },
            },
          },
        },
      });
      return doctors;
    } catch (error: unknown) {
      console.error("Error fetching doctors", error);
      throw error;
    }
  }
  async fetchPatientDoctors(patientId: string) {
    try {
      const patient = await getPatientById(patientId);
      if (!patient) {
        throw new Error("patient not found");
      }
      const doctors = await prisma.user.findMany({
        where: {
          id: { in: patient.doctorIds },
        },
        include: {
          availabilities: {
            include: {
              days: {
                orderBy: {
                  date: "asc",
                },
                include: {
                  slots: {
                    orderBy: {
                      startTime: "asc",
                    },
                  },
                },
              },
            },
          },
        },
      });
      return doctors;
    } catch (error: unknown) {
      console.error("Error fetching patient doctors", error);
      throw error;
    }
  }
}

export default new DoctorsService();
