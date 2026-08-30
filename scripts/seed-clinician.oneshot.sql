-- ONE statement (query boxes that split on ";" cannot break it): test clinician
-- "Dr. Giulia Rossi" + a week of 30-minute slots (09:00–12:00, today + 6 days,
-- UTC day) + care-team grant for the patient e-mail below.
-- Re-running adds ANOTHER week of slots (harmless duplicates); the clinician
-- and the grant are upserted.
WITH c AS (
  INSERT INTO "Clinician" (id, email, "firstName", "lastName", "phoneNumber", specialty, "clinicName",
                           "addressLine1", city, state, "zipCode", country, "acceptedInsurances",
                           "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'dev-clinician@ollo.test', 'Giulia', 'Rossi', '+390000000000',
          'Internal medicine', 'Ollo Dev Clinic', 'Via Roma 1', 'Milano', 'MI', '20121', 'IT', '{}',
          true, now(), now())
  ON CONFLICT (email) DO UPDATE SET "isActive" = true, "updatedAt" = now()
  RETURNING id
), w AS (
  INSERT INTO "WeeklyAvailability" (id, "clinicianId", "weekStartDate", "weekEndDate", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, c.id, to_char(current_date, 'MM-DD-YYYY'), to_char(current_date + 6, 'MM-DD-YYYY'), now(), now()
  FROM c
  RETURNING id
), d AS (
  INSERT INTO "DailyAvailability" (id, "weekId", date, "isCancelled")
  SELECT gen_random_uuid()::text, w.id, to_char(current_date + g, 'MM-DD-YYYY'), false
  FROM w, generate_series(0, 6) AS g
  RETURNING id
), s AS (
  INSERT INTO "TimeSlot" (id, "dailyAvailabilityId", "startTime", "endTime", "isBooked", "isAvailable")
  SELECT gen_random_uuid()::text, d.id,
         lpad(h::text, 2, '0') || ':' || m,
         CASE WHEN m = '00' THEN lpad(h::text, 2, '0') || ':30' ELSE lpad((h + 1)::text, 2, '0') || ':00' END,
         false, true
  FROM d, generate_series(9, 11) AS h, (VALUES ('00'), ('30')) AS mm(m)
  RETURNING id
)
INSERT INTO "CareTeamMember" (id, "patientId", "clinicianId", source, "addedAt")
SELECT gen_random_uuid()::text, p.id, c.id, 'SEED', now()
FROM c, "Patient" p
WHERE p.email = 'antoricciardelli@gmail.com'
ON CONFLICT ("patientId", "clinicianId") DO UPDATE SET "revokedAt" = NULL
RETURNING "clinicianId", "patientId";
