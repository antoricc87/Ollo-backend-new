import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import prisma from "../utility/prismaClient";
import moment from "moment";
dotenv.config();

/** Patient tokens live 30 days and are refreshed on use (see verifyToken). */
const PATIENT_TOKEN_TTL = "30d";
/** A token older than this gets replaced on the next authenticated request. */
const REFRESH_AFTER_SECONDS = 7 * 24 * 3600;

const signJWT = async (data: any) => {
  const token = jwt.sign(data, process.env.JWT_SECRET || "", {
    expiresIn: PATIENT_TOKEN_TTL,
  });
  return token;
};

/**
 * Ownership guard. Legacy handlers read the patient id from the body/query
 * instead of the token; rather than rewrite each one, verifyToken (a) fills
 * a missing `patientId` / `userId` with the caller's own id and (b) rejects
 * any id that is neither the caller nor one of their sub-accounts.
 */
const ID_FIELDS = ["patientId", "userId"] as const;
const ownedOrSubAccount = async (callerId: string, requested: unknown): Promise<boolean> => {
  if (typeof requested !== "string" || !requested) return true;
  if (requested === callerId) return true;
  const sub = await prisma.patient.findFirst({
    where: { id: requested, subAccountOf: callerId },
    select: { id: true },
  });
  return !!sub;
};

const enforceOwnership = async (req: any, callerId: string): Promise<boolean> => {
  const holders: any[] = [req.body, req.body?.bookingData, req.query, req.params].filter(
    (h) => h && typeof h === "object"
  );
  for (const holder of holders) {
    for (const field of ID_FIELDS) {
      const value = holder[field];
      if (value === undefined || value === null || value === "") {
        if (holder === req.body) holder[field] = callerId;
        continue;
      }
      if (!(await ownedOrSubAccount(callerId, value))) return false;
    }
  }
  return true;
};

const verifyToken = (req: any, res: Response, next: NextFunction) => {
  const token = Array.isArray(req.headers["access-token"])
    ? req.headers["access-token"][0]
    : req.headers["access-token"];

  if (!token) {
    return res.status(401).json({
      message: "Unauthorized! Token is required",
    });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "",
    (err: jwt.VerifyErrors | null, decoded: any) => {
      if (err) {
        console.log(err);
        return res.status(401).json({
          message: "Unauthorized! Token is invalid or expired",
        });
      } else {
        if (!decoded.user || !decoded.user.id) {
          // Malformed/legacy token payload — reject instead of letting
          // downstream handlers crash on req.user being undefined.
          return res.status(401).json({
            message: "Unauthorized! Token payload is invalid — sign in again",
          });
        }
        req.user = decoded.user;
        (async () => {
          const ok = await enforceOwnership(req, decoded.user.id);
          if (!ok) return res.status(403).json({ message: "Forbidden! That record is not yours" });
          // Refresh on use: hand back a fresh token once the current one is
          // a week old, and keep the stored copy in sync so responses that
          // return the user row carry the new one.
          const issuedAt = typeof decoded.iat === "number" ? decoded.iat : 0;
          if (issuedAt && Date.now() / 1000 - issuedAt > REFRESH_AFTER_SECONDS) {
            try {
              const fresh = await signJWT({ user: { id: decoded.user.id } });
              res.setHeader("x-refreshed-token", fresh);
              res.setHeader("Access-Control-Expose-Headers", "x-refreshed-token");
              void updateUserToken(decoded.user.id, fresh).catch(() => undefined);
            } catch (e) {
              console.warn("token refresh failed", e);
            }
          }
          next();
        })().catch((e) => {
          console.error("verifyToken", e);
          res.status(500).json({ message: "Auth check failed" });
        });
      }
    }
  );
};

const getUserToken = async (userId: string) => {
  try {
    const token = await prisma.userToken.findFirst({
      where: { userId: userId },
    });
    if (token) return token.token;
  } catch (error: any) {
    console.error("Error fetching the user token");
    throw error;
  }
};

const updateUserToken = async (patientId: string, token: any) => {
  try {
    let userToken = await prisma.userToken.findFirst({
      where: { userId: patientId },
    });
    if (userToken) {
      await prisma.userToken.update({
        where: { id: userToken.id },
        data: { token: token, updatedAt: moment().toDate() },
      });
    } else {
      await prisma.userToken.create({
        data: {
          userId: patientId,
          token: token,
          isActive: true,
          isDeleted: false,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      });
    }
  } catch (error: unknown) {
    console.error("Error updating token");
  }
};
// Doctor Tokens System
const signDoctorJWT = async (data: any) => {
  const token = jwt.sign(data, process.env.JWT_SECRET_DOCTOR || "", {
    // expiresIn: "4d",
    expiresIn: "9999y",
    // issuer: process.env.JWT_ISSUER,
  });
  return token;
};

//admin token system
const verifyDoctorToken = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  // 1. Try from header first
  let token = Array.isArray(req.headers["access-token"])
    ? req.headers["access-token"][0]
    : req.headers["access-token"];

  // 2. If no header, try from cookies
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }
  if (!token) {
    return res.status(401).json({
      message: "Unauthorized! A valid doctor token is required.",
    });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET_DOCTOR || "",
    async (err: jwt.VerifyErrors | null, decoded: any) => {
      if (err) {
        console.log("JWT verification error:", err);
        return res.status(401).json({
          message: "Unauthorized! Doctor token is invalid or expired.",
        });
      }

      try {
        const userId = decoded?.user?.id;

        const isValidToken = await prisma.userToken.findUnique({
          where: {
            userId: userId,
            token: token,
          },
        });

        if (!isValidToken) {
          return res.status(401).json({
            message: "Unauthorized! Token is not active or has been revoked.",
          });
        }

        req.user = decoded.user;
        next();
      } catch (dbErr) {
        console.error("Token DB check failed:", dbErr);
        return res.status(500).json({
          message: "Internal server error while validating token.",
        });
      }
    }
  );
};

const signAdminJWT = async (data: any) => {
  const token = jwt.sign(data, process.env.JWT_SECRET_ADMIN || "", {
    // expiresIn: "4d",
    expiresIn: "9999y",
    // issuer: process.env.JWT_ISSUER,
  });
  return token;
};

const verifyAdminToken = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  let token = Array.isArray(req.headers["access-token"])
    ? req.headers["access-token"][0]
    : req.headers["access-token"];
  if (!token && req.cookies?.token) {
    token = req.cookies.token;
  }
  if (!token) {
    return res.status(401).json({
      message: "Unauthorized! A valid admin token is required.",
    });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET_ADMIN || "",
    async (err: jwt.VerifyErrors | null, decoded: any) => {
      if (err) {
        console.log("JWT verification error:", err);
        return res.status(401).json({
          message: "Unauthorized! Admin token is invalid or expired.",
        });
      }

      try {
        const userId = decoded?.user?.id;

        const isValidToken = await prisma.userToken.findUnique({
          where: {
            userId: userId,
            token: token,
          },
        });

        if (!isValidToken) {
          return res.status(401).json({
            message: "Unauthorized! Token is not active or has been revoked.",
          });
        }

        req.user = decoded.user;
        next();
      } catch (dbErr) {
        console.error("Token DB check failed:", dbErr);
        return res.status(500).json({
          message: "Internal server error while validating token.",
        });
      }
    }
  );
};

export {
  signJWT,
  verifyToken,
  getUserToken,
  updateUserToken,
  signDoctorJWT,
  verifyDoctorToken,
  signAdminJWT,
  verifyAdminToken,
};
