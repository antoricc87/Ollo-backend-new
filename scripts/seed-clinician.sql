-- Seed one test clinician ("Dr. Giulia Rossi") with a week of 30-minute slots
-- (09:00–12:00, today + 6 days) and put them on a patient's care team.
-- Pure SQL twin of scripts/seed-dev-clinician.ts, for environments where you
-- only have a query box (Railway → Postgres → Data tab). Idempotent.
-- Change the email on the first line if you want a different patient.

DO $$
DECLARE
  patient_email text := 'antoricciardelli@gmail.com';
  pid text;
  cid text;
  wid text;
  did text;
  d int;
  h int;
  week_start date := current_date;
BEGIN
  SELECT id INTO pid FROM "Patient" WHERE email = patient_email;
  IF pid IS NULL THEN
    RAISE EXCEPTION 'patient % not found', patient_email;
  END IF;

  INSERT INTO "Clinician" (id, email, "firstName", "lastName", "phoneNumber", specialty, "clinicName",
                           "addressLine1", city, state, "zipCode", country, "acceptedInsurances",
                           "isActive", "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, 'dev-clinician@ollo.test', 'Giulia', 'Rossi', '+390000000000',
          'Internal medicine', 'Ollo Dev Clinic', 'Via Roma 1', 'Milano', 'MI', '20121', 'IT', '{}',
          true, now(), now())
  ON CONFLICT (email) DO UPDATE SET "isActive" = true, "updatedAt" = now()
  RETURNING id INTO cid;

  -- one week of availability (skip if this week already exists)
  SELECT id INTO wid FROM "WeeklyAvailability"
   WHERE "clinicianId" = cid
     AND "weekStartDate" = to_char(week_start, 'MM-DD-YYYY')
     AND "weekEndDate"   = to_char(week_start + 6, 'MM-DD-YYYY');
  IF wid IS NULL THEN
    INSERT INTO "WeeklyAvailability" (id, "clinicianId", "weekStartDate", "weekEndDate", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, cid, to_char(week_start, 'MM-DD-YYYY'), to_char(week_start + 6, 'MM-DD-YYYY'), now(), now())
    RETURNING id INTO wid;

    FOR d IN 0..6 LOOP
      INSERT INTO "DailyAvailability" (id, "weekId", date, "isCancelled")
      VALUES (gen_random_uuid()::text, wid, to_char(week_start + d, 'MM-DD-YYYY'), false)
      RETURNING id INTO did;

      FOR h IN 9..11 LOOP
        INSERT INTO "TimeSlot" (id, "dailyAvailabilityId", "startTime", "endTime", "isBooked", "isAvailable")
        VALUES (gen_random_uuid()::text, did, lpad(h::text, 2, '0') || ':00', lpad(h::text, 2, '0') || ':30', false, true),
               (gen_random_uuid()::text, did, lpad(h::text, 2, '0') || ':30', lpad((h + 1)::text, 2, '0') || ':00', false, true);
      END LOOP;
    END LOOP;
  END IF;

  -- care-team grant
  INSERT INTO "CareTeamMember" (id, "patientId", "clinicianId", source, "addedAt", "revokedAt")
  VALUES (gen_random_uuid()::text, pid, cid, 'SEED', now(), NULL)
  ON CONFLICT ("patientId", "clinicianId") DO UPDATE SET "revokedAt" = NULL;

  RAISE NOTICE 'clinician % linked to patient %', cid, pid;
END $$;
