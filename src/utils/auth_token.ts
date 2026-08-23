import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import prisma from "../utility/prismaClient";
import moment from "moment";
dotenv.config();

const signJWT = async (data: any) => {
  const token = jwt.sign(data, process.env.JWT_SECRET || "", {
    // expiresIn: "4d",
    expiresIn: "9999y",
    // issuer: process.env.JWT_ISSUER,
  });
  return token;
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
        next();
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
