import express, { Request, Response } from "express";

export interface LabCategory {
  organ: string;
  description: string;
}

export interface PatientRecord {
  resourceType: string;
  name?: { given: string[]; family: string }[];
  component: any;
  gender?: string;
  birthDate?: string;
  code?: { text: string; coding: any };
  vaccineCode?: { text: string };
  reaction?: { manifestation: { text: string }[] }[];
  clinicalStatus?: { coding: { code: string }[] };
  verificationStatus?: { coding: { code: string }[] };
  onsetDateTime?: string;
  medicationCodeableConcept?: { text: string };
  dosage?: { text: string };
  subject?: { reference: string };
  performedPeriod?: { start: string; end: string };
  valueQuantity?: { value: number; unit: string };
  encounter?: { reference: string };
  effectiveDateTime?: string;
  status?: string;
}
export type PatientSummary = {
  Allergies?: AllergySummary[];
  Conditions?: ConditionSummary[];
  Medications?: object[];
  [key: string]: any;
};
export type AllergySummary = {
  id: string;
  patientSummaryId: string;
  conditionId: string;
  allergy: Allergy;
};
export type Allergy = {
  id: string;
  substance: string;
  status: string;
  reactions: string[];
};
export type ConditionSummary = {
  id: string;
  patientSummaryId: string;
  conditionId: string;
  condition: Condition;
};
export type Condition = {
  id: string;
  name: string;
  clinicalStatus: string;
  verificationStatus: string;
  onset: string;
};
export interface Summary {
  Name: string;
  Gender: string;
  BirthDate: string;
  Allergies: { Substance: string; Reactions: string[] }[];
  Conditions: {
    Condition: string;
    ClinicalStatus: string;
    VerificationStatus: string;
    Onset: string;
  }[];
  Medications: { Medication: string; Dosage: string; Status: string }[];
  Procedures: { Procedure: string; Period: string }[];
  Immunizations: string[];
  LabResults: {
    [category: string]: {
      TestType: string;
      Description: string;
      Results: { Result: string; normal: any; message: string }[];
    }[];
  };
  VitalSigns: {
    [key: string]: { Value: string; issued: string; Description: string }[];
  };
}

export interface RegisterRequest extends Request {
  body: {
    username: string;
    email: string;
    password: string;
    specialty: string;
  };
}
export interface LoginRequest extends Request {
  body: {
    email: string;
    password: string;
  };
}
export interface FhirSettings {
  clientId: string;
  redirectUri: string;
  scope: string;
  iss: string;
  state?: string;
}
export interface ExtendedRecord {
  id: string;
  notes: string;
  allRecords: string;
  allergies: {
    id: string;
    name: string;
    reaction: string;
    severity: string;
    date: Date;
    recordId: string;
  }[];
  clinicalVitals: {
    id: string;
    type: string;
    value: string;
    unit: string;
    date: Date;
    recordId: string;
  }[];
  conditions: {
    id: string;
    name: string;
    severity: string;
    status: string;
    date: Date;
    recordId: string;
  }[];
  immunizations: {
    id: string;
    name: string;
    date: Date;
    recordId: string;
  }[];
  labResults: {
    id: string;
    testName: string;
    result: string;
    unit: string;
    date: Date;
    recordId: string;
  }[];
  medicationRecords: {
    id: string;
    medicationName: string;
    dosage: string;
    frequency: string;
    date: Date;
    recordId: string;
  }[];
  procedures: {
    id: string;
    name: string;
    date: Date;
    recordId: string;
  }[];
  summary?: string | null;
  patientId: string;
}

export interface VisitRequest extends Request {
  body: {
    fhirPatientId: string;
    patientSymptoms: JSON;
    postVisitNote: string;
  };
}

export interface CreatePatientRequest extends Request {
  body: {
    firstName: string;
    lastName: string;
    middleName?: string;
    dob: string;
    gender: string;
    doctorId: string[];
    email: string;
    records: {
      notes: string;
      allRecords: string;
      allergies: {
        name: string;
        reaction: string;
        severity: string;
        date: string;
      }[];
      clinicalVitals: {
        type: string;
        value: string;
        unit: string;
        date: string;
      }[];
      conditions: {
        name: string;
        severity: string;
        status: string;
        date: string;
      }[];
      immunizations: { name: string; date: string }[];
      labResults: {
        testName: string;
        result: string;
        unit: string;
        date: string;
      }[];
      medicationRecords: {
        medicationName: string;
        dosage: string;
        frequency: string;
        date: string;
      }[];
      procedures: { name: string; date: string }[];
      summary: string;
    }[];
    summary: string;
  };
}

export type CaloriesTrackerWhereUniqueInput = {
  // id?: string;
  userId: string;
};
export type ExercisesTrackerWhereUniqueInput = {
  // id?: string;
  userId: string;
};

export type UserRegisterRequest = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  specialty?: string;
  bio?: string;
  profileImageUrl?: string;
  npiNumber?: string;
  licenseNumber?: string;
  licenseState?: string;
  licenseExpiry?: string;
  clinicName?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  role: string;
  twoFactorEnabled: boolean;
  twoFactorSecret?: string;
  lastLogin?: Date;
};

export type FoodTrackerWhereUniqueInput = {
  userId: string;
};

export interface TrackableMetric {
  id: string;
  healthGoalId: string;
  description: string;
  targetValue: string;
  currentValue: string;
  unit: string;
  value: string;
  patientId: string;
  category: string;
  frequency: string;
  reviewDate?: Date | null;
  status: string;
}

export type Nutrients = {
  carbohydrates?: number;
  proteins?: number;
  fats?: number;
  fiber?: number;
  sodium?: number;
  naturalSugar?: number;
  addedSugar?: number;
  calcium?: number;
  magnesium?: number;
  iron?: number;
  potassium?: number;
  omega_3?: number;
  cholesterol?: number;
  zinc?: number;
  vitaminC?: number;
  vitaminE?: number;
  vitaminB12?: number;
  vitaminD?: number;
};
export type FavMeal = {
  id: string;
  userId: string;
  date: string;
  ingredients: FavFood[];
};

export type FavFood = {
  id: string;
  patientId: string;
  favMealId?: string;
  favMeal?: FavMeal;
  description: string;
  quantity: string;
  calories: number;
  carbohydrates?: number;
  proteins?: number;
  fats?: number;
  fiber?: number;
  sodium?: number;
  naturalSugar?: number;
  addedSugar?: number;
  calcium?: number;
  magnesium?: number;
  iron?: number;
  potassium?: number;
  omega_3?: number;
  cholesterol?: number;
  zinc?: number;
  vitaminD?: number;
  vitaminC?: number;
  vitaminB12?: number;
  vitaminE?: number;
  createdAt?: string;
};

export interface LabResultSummary {
  id: string;
  patientSummaryId: string;
  createdAt?: Date | string; // upload time
  collectedAt?: Date | string | null; // test date (null on legacy rows)
  labReport: string;
  patientSummary?: PatientSummary; // Add the type for `PatientSummary` if needed
  labResults: LabResult[]; // Relation to the `LabResult`
}

export type LabResult = {
  id: string; // Corresponds to @id @map("_id") @db.ObjectId
  category: string;
  testType: string;
  referenceRange: string;
  isOutOfRange: boolean;
  result: string;
  units?: string; // Optional as indicated by the `?` in your schema
  labResultSummaryId: string; // Replace 'any' with a specific type for LabResultSummary if defined
};

export interface MacroNutrients {
  carbohydrates: number;
  proteins: number;
  fats: number;
  fiber: number;
  sodium: number;
  naturalSugar: number;
  addedSugar: number;
  calcium: number;
  magnesium: number;
}

export interface SymptomState {
  symptoms: string[];
  followUpQuestions: string[];
  answers: Record<string, string>; // Key-value pairs of question -> answer
  completed: boolean;
}

export enum MealType {
  BREAKFAST = "BREAKFAST",
  LUNCH = "LUNCH",
  DINNER = "DINNER",
  SNACK = "SNACK",
}
export type Gender = "male" | "female" | "other";

export interface Patient {
  age: number;
  gender: Gender;
  conditions: string[];
  //   allergies: string[];
  familyHistory: string[];
  //   medications: string[];
}

export type BookingData = {
  patientId: string;
  doctorId: string;
  appointmentDate: String;
  duration: number;
  reason: string;
};
export type TimeSlot = {
  start: string;
  end: string;
  isAvailable: boolean;
};
export type DailyAvailabilities = {
  day: string;
  timeSlots: TimeSlot[];
};

export type WeeklyAvailabilities = {
  weekStartDate: string;
  weekEndDate: string;
  dailyAvailabilities: DailyAvailabilities[];
};

export interface GlucoseEntry {
  id: string;
  value: number;
  createdAt: string;
  dailyTrackerId: string;
}

export interface DailyEntry {
  id: string;
  userId: string;
  date: string;
  weeklyTrackerId: string;
  trackerId: string;
  glucoseEntries: GlucoseEntry[];
}

export interface WeeklyEntry {
  id: string;
  userId: string;
  weekStartDate: string;
  weekEndDate: string;
  trackerId: string;
  dailyEntries: DailyEntry[];
}

export interface GlucoseTracker {
  weeklyEntries: WeeklyEntry[];
}

export interface Reading {
  date: string;
  value: number;
}

export interface BpEntry {
  id: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
  createdAt: string;
  dailyTrackerId: string;
}

export interface DailyBP {
  id: string;
  userId: string;
  date: string; // e.g. "05-12-2025"
  weeklyTrackerId: string;
  trackerId: string;
  bpEntries: BpEntry[];
}

export interface WeeklyBP {
  id: string;
  userId: string;
  weekStartDate: string; // ISO string
  weekEndDate: string; // ISO string
  trackerId: string;
  dailyEntries: DailyBP[];
}

export interface BloodPressureTracker {
  weeklyEntries: WeeklyBP[];
}

export type DiabeteRiskData = {
  age: number;
  gender: "M" | "F";
  systolicBp: number;
  diastolicBp: number;
  hypertensionTreatment: boolean;
  height: number;
  weight: number;
  hdl: number;
  triglycerides: number;
  fastingGlucose: number;
  parentalDiabetes: boolean;
};

export type CVRiskData = {
  gender: "M" | "F";
  age: number;
  sbp: number;
  tcl: number;
  hdl: number;
  smoker: boolean;
  diabetic: boolean;
  treatmentStatus: "noTreatment" | "treatment";
};

export type BiologicalAgeData = {
  age: number;
  albumin: number;
  creatinine: number;
  glucose: number;
  crp: number;
  rdw: number;
  wbc: number;
  mcv: number;
  lympocyte: number;
  alkalinePhosphatase: number;
};
