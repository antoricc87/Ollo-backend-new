import { summarizePatientRecord } from "../../src/utility/recordSummary";
import { Summary } from "../../src/types";
import { checkAbnormalValues } from "../../src/utils/check_labs_abnormal_values";
import { getCategory } from "../../src/utils/get_lab_category";
import { relevantProcedureCodes } from "../../src/utility/procedures_codes";

jest.mock("../../src/utils/check_labs_abnormal_values", () => ({
  checkAbnormalValues: jest.fn(),
}));

jest.mock("../../src/utils/get_lab_category", () => ({
  getCategory: jest.fn(),
}));

jest.mock("../../src/utility/procedures_codes", () => ({
  relevantProcedureCodes: ["12345", "67890"],
}));

describe("Patient Summary Functions", () => {
  describe("getYear", () => {
    const { getYear } = require("../../src/utility/recordSummary");

    it("should return the year from a valid date string", () => {
      expect(getYear("2024-12-15")).toBe("2024");
    });

    it("should return 'NaN' for an invalid date string", () => {
      expect(getYear("invalid-date")).toBe("NaN");
    });
  });

  describe("summaryToPlainText", () => {
    const { summaryToPlainText } = require("../../src/utility/recordSummary");

    const mockSummary: Summary = {
      Name: "John Doe",
      Gender: "Male",
      BirthDate: "1980-01-01",
      Allergies: [
        {
          Substance: "Pollen",
          Reactions: ["Sneezing", "Watery Eyes"],
        },
      ],
      Conditions: [
        {
          Condition: "Asthma",
          ClinicalStatus: "active",
          VerificationStatus: "confirmed",
          Onset: "2005",
        },
      ],
      Medications: [
        {
          Medication: "Albuterol",
          Dosage: "1 puff as needed",
          Status: "active",
        },
      ],
      Procedures: [
        {
          Procedure: "Appendectomy",
          Period: "2000",
        },
      ],
      Immunizations: ["Tetanus", "Hepatitis B"],
      LabResults: {
        Blood: [
          {
            TestType: "Hemoglobin",
            Description: "Protein in red blood cells",
            Results: [
              {
                Result: "15 g/dL",
                normal: true,
                message: "Normal range",
              },
            ],
          },
        ],
      },
      VitalSigns: {
        "Blood Pressure": [
          {
            Value: "120/80 mmHg",
            issued: "2024",
            Description: "Normal blood pressure",
          },
        ],
      },
    };

    it("should convert a summary object to a plain text string", () => {
      const result = summaryToPlainText(mockSummary);
      expect(result).toContain("Name: John Doe");
      expect(result).toContain("Allergies:");
      expect(result).toContain("Substance: Pollen");
      expect(result).toContain("Results:");
    });
  });

  describe("summarizePatientRecord", () => {
    const mockCheckAbnormalValues = jest.fn().mockReturnValue({
      normal: true,
      message: "Normal range",
    });
    const mockGetCategory = jest.fn().mockReturnValue({
      organ: "Blood",
      description: "Blood-related tests",
    });

    beforeEach(() => {
      jest.clearAllMocks();
      (checkAbnormalValues as jest.Mock).mockImplementation(
        mockCheckAbnormalValues
      );
      (getCategory as jest.Mock).mockImplementation(mockGetCategory);
    });

    const mockData = {
      patient_data: {
        name: [{ given: ["John"], family: "Doe" }],
        gender: "Male",
        birthDate: "1980-01-01",
      },
      patient_allergies: {
        entry: [
          {
            resource: {
              code: { text: "Pollen" },
              reaction: [
                {
                  manifestation: [
                    { text: "Sneezing" },
                    { text: "Watery Eyes" },
                  ],
                },
              ],
            },
          },
        ],
      },
      patient_procedures: {
        entry: [
          {
            resource: {
              code: { coding: [{ code: "12345" }], text: "Appendectomy" },
              performedPeriod: { start: "2000-01-01" },
            },
          },
        ],
      },
      patient_conditions: {
        entry: [
          {
            resource: {
              code: { text: "Asthma" },
              clinicalStatus: { coding: [{ code: "active" }] },
              verificationStatus: { coding: [{ code: "confirmed" }] },
              onsetDateTime: "2005-01-01",
            },
          },
        ],
      },
      patient_medications: {
        entry: [
          {
            resource: {
              medicationCodeableConcept: { text: "Albuterol" },
              dosage: [{ text: "1 puff as needed" }],
              status: "active",
            },
          },
        ],
      },
      patient_labs: {
        entry: [
          {
            resource: {
              code: { text: "Hemoglobin" },
              valueQuantity: { value: 15, unit: "g/dL" },
            },
          },
        ],
      },
      patient_vitals: {
        entry: [
          {
            resource: {
              code: { text: "Blood Pressure" },
              valueQuantity: { value: "120/80", unit: "mmHg" },
              effectiveDateTime: "2024-01-01",
            },
          },
        ],
      },
    };

    it("should return a structured summary object when format is 'object'", () => {
      const result = summarizePatientRecord(mockData, "object");

      expect(result).toMatchObject({
        Name: "John Doe",
        Gender: "Male",
        BirthDate: "1980-01-01",
        Allergies: [
          {
            Substance: "Pollen",
            Reactions: ["Sneezing, Watery Eyes"],
          },
        ],
        Conditions: [
          {
            Condition: "Asthma",
            ClinicalStatus: "active",
            VerificationStatus: "confirmed",
            Onset: "2005",
          },
        ],
        Procedures: [
          {
            Procedure: "Appendectomy",
            Period: "2000",
          },
        ],
        Medications: [
          {
            Medication: "Albuterol",
            Dosage: "1 puff as needed",
            Status: "active",
          },
        ],
      });
    });

    it("should return a plain text summary when format is 'text'", () => {
      const result = summarizePatientRecord(mockData, "text");
      expect(result).toContain("Name: John Doe");
      expect(result).toContain("Gender: Male");
      expect(result).toContain("BirthDate: 1980-01-01");
    });
  });
});
