/**
 * SEAM AUTH — guards for `/api/seam/*`, the only surface the clinician
 * service (Ollo-Clinician-Service) talks to. Never reachable with a patient
 * JWT: these routes do not use `verifyToken` at all.
 *
 * Three layers, composed per route:
 *   requireSeamKey   — `Authorization: Bearer <SEAM_SERVICE_KEY>`; 401 otherwise.
 *                      Keys are read from SEAM_SERVICE_KEYS (comma-separated, so a
 *                      second key can be added before the first is retired) or
 *                      SEAM_SERVICE_KEY. No key configured → 503, fail closed.
 *   requireClinician — `X-Clinician-External-Id` must match an ACTIVE Clinician
 *                      directory row; attaches `req.seam.clinician`.
 *   requireGrant     — the patient in `req.params[param]` must have an active
 *                      CareTeamMember for that clinician; 403 otherwise.
 * `logSeamAccess(resource)` writes a SeamAccessLog row when the response ends.
 */
import { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import prisma from "../../utility/prismaClient";
import Util from "../../utils/response";

export type SeamClinician = { id: string; externalId: string; firstName: string; lastName: string };
export type SeamRequest = Request & { seam?: { clinician?: SeamClinician; patientId?: string } };

export const CLINICIAN_HEADER = "x-clinician-external-id";

const configuredKeys = (): string[] =>
  (process.env.SEAM_SERVICE_KEYS ?? process.env.SEAM_SERVICE_KEY ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length >= 32);

const keyMatches = (presented: string, key: string): boolean => {
  const a = Buffer.from(presented);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const requireSeamKey = (req: Request, res: Response, next: NextFunction) => {
  const keys = configuredKeys();
  if (keys.length === 0) {
    return res.status(503).json(Util.error({}, "Seam is not configured on this backend"));
  }
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented || !keys.some((k) => keyMatches(presented, k))) {
    return res.status(401).json(Util.error({}, "Invalid seam service key"));
  }
  return next();
};

export const requireClinician = async (req: SeamRequest, res: Response, next: NextFunction) => {
  const externalId = String(req.headers[CLINICIAN_HEADER] ?? "").trim();
  if (!externalId) {
    return res.status(401).json(Util.error({}, `Missing ${CLINICIAN_HEADER} header`));
  }
  try {
    const clinician = await prisma.clinician.findUnique({
      where: { externalId },
      select: { id: true, externalId: true, firstName: true, lastName: true, isActive: true },
    });
    if (!clinician || !clinician.isActive) {
      return res.status(403).json(Util.error({}, "Unknown or inactive clinician"));
    }
    req.seam = { ...(req.seam ?? {}), clinician: { ...clinician, externalId } };
    return next();
  } catch (error) {
    console.error("seam: clinician lookup failed", error);
    return res.status(500).json(Util.error({}, "Clinician lookup failed"));
  }
};

/** Patient-scoped routes: the clinician must hold an active grant for `req.params[param]`. */
export const requireGrant =
  (param = "id") =>
  async (req: SeamRequest, res: Response, next: NextFunction) => {
    const clinician = req.seam?.clinician;
    const patientId = String(req.params[param] ?? "").trim();
    if (!clinician) return res.status(401).json(Util.error({}, "Clinician not resolved"));
    if (!patientId) return res.status(400).json(Util.error({}, "Patient id is required"));
    try {
      const grant = await prisma.careTeamMember.findFirst({
        where: { patientId, clinicianId: clinician.id, revokedAt: null },
        select: { id: true },
      });
      if (!grant) return res.status(403).json(Util.error({}, "No active grant for this patient"));
      req.seam = { ...req.seam, patientId };
      return next();
    } catch (error) {
      console.error("seam: grant lookup failed", error);
      return res.status(500).json(Util.error({}, "Grant lookup failed"));
    }
  };

/** Append a SeamAccessLog row once the response has finished (fire-and-forget). Mounted FIRST so denials (401/403) are recorded too. */
export const logSeamAccess =
  (resource: string) => (req: SeamRequest, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      const clinician = req.seam?.clinician;
      prisma.seamAccessLog
        .create({
          data: {
            clinicianExternalId:
              clinician?.externalId ?? (String(req.headers[CLINICIAN_HEADER] ?? "") || null),
            clinicianId: clinician?.id ?? null,
            patientId: req.seam?.patientId ?? null,
            method: req.method,
            path: req.originalUrl.split("?")[0],
            resource,
            status: res.statusCode,
          },
        })
        .catch((e: unknown) => console.error("seam: access log write failed", e));
    });
    next();
  };
