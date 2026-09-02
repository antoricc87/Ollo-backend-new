import { z } from "zod";

/** Directory fields the clinician service publishes for a clinician (PUT /api/seam/clinicians/:externalId). */
export const clinicianUpsertSchema = z.object({
  email: z.string().email().max(200),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phoneNumber: z.string().max(40).nullable().optional(),
  specialty: z.string().max(120).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  profileImageUrl: z.string().url().max(500).nullable().optional(),
  npiNumber: z.string().max(20).nullable().optional(),
  clinicName: z.string().max(200).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  zipCode: z.string().max(20).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  acceptedInsurances: z.array(z.string().max(100)).max(50).optional(),
  isActive: z.boolean().optional(),
});
export type ClinicianUpsert = z.infer<typeof clinicianUpsertSchema>;
