import express, { Request, Response } from "express";
import { Util } from "../../../utils/response";
import UserServices from "../model/user.model";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { signDoctorJWT, signJWT } from "../../../utils/auth_token";
import dotenv from "dotenv";
import { create } from "domain";
import { ObjectId } from "../../../utils/idValidation";
import { use } from "react";
dotenv.config();

const prisma = new PrismaClient();

export class UserHandler {
  async createUser(request: Request, response: Response) {
    const { userData } = request.body;
    const requiredFields = [
      "password",
      "firstName",
      "lastName",
      "phoneNumber",
      "addressLine1",
      "city",
      "state",
      "zipCode",
      "country",
      "role",
      "email",
    ];

    const isEmpty = (value: any) =>
      value === undefined || value === null || value === "";

    const missingMandatoryInfo =
      !userData || requiredFields.some((field) => isEmpty(userData[field]));

    const isDoctor = userData?.role?.toUpperCase?.() === "DOCTOR";

    const doctorRequiredFields = [
      "specialty",
      "npiNumber",
      "licenseNumber",
      "licenseState",
      "licenseExpiry",
    ];

    const missingDoctorInfo =
      isDoctor &&
      doctorRequiredFields.some((field) => isEmpty(userData[field]));

    if (isDoctor) {
      if (!/^\d{10}$/.test(userData.npiNumber)) {
        return response
          .status(400)
          .json(Util.error({}, "NPI Number must be exactly 10 digits"));
      }

      if (!/^[A-Z0-9]{5,15}$/i.test(userData.licenseNumber)) {
        return response
          .status(400)
          .json(
            Util.error(
              {},
              "License Number must be 5–15 alphanumeric characters"
            )
          );
      }
    }
    if (isDoctor && missingDoctorInfo)
      return response
        .status(400)
        .json(Util.error({}, "Required doctor's information is missing"));

    if (missingMandatoryInfo)
      return response
        .status(400)
        .json(
          Util.error(
            {},
            "One or more required information are missing (email,password,first name, last name, phone number, addressline, city, state, zipcode, country, role.)"
          )
        );
    try {
      const createdUser = await UserServices.createUser(userData);
      if (createdUser)
        return response
          .status(201)
          .json(Util.success(createdUser, "User created successfully"));
    } catch (error: unknown) {
      if (error instanceof Error) {
        return response.status(401).json(Util.error({}, error.message));
      }
      return response.status(500);
    }
  }
  async userLogin(request: Request, response: Response) {
    const { email, password } = request.body;
    if (!email || !password)
      return response
        .status(400)
        .json(Util.error({}, "Email or Password is missing"));
    try {
      const userLogged = await UserServices.userLogin(email, password);
      if (userLogged) {
        const { token, ...userWithoutToken } = userLogged;
        response.cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          maxAge: 45 * 60 * 1000,
          path: "/",
        });
        return response
          .status(200)
          .json(Util.success(userWithoutToken, "User logged in successfully"));
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        return response.status(401).json(Util.error({}, error.message));
      }
      return response
        .status(500)
        .json(Util.error({}, "Error logging the user"));
    }
  }
  //update user
  // async updateUser(request: Request, response: Response) {
  //   const { username, email, password, specialty } = request.body;
  //   const { id } = request.params;
  //   try {
  //     const updatedUser = await prisma.user.update({
  //       where: { id },
  //       data: {
  //         username,
  //         email,
  //         password: password ? await bcrypt.hash(password, 10) : undefined,
  //         specialty,
  //       },
  //     });
  //     response.json(updatedUser);
  //   } catch (err: any) {
  //     console.error(err.message);
  //     response.status(500).send("Server error");
  //   }
  // }
  //delete user
  async deleteUser(request: Request, response: Response) {
    const { id } = request.params;
    if (!id || !ObjectId.isValid(id))
      return response
        .status(400)
        .json(Util.error({}, "User id missing or invalid"));
    try {
      const deletedUser = await UserServices.deleteUser(id);
      response
        .status(200)
        .json(Util.success(deletedUser, "Patient deleted successfully"));
    } catch (error: any) {
      console.error("Error deleting the patient", error);
      return response
        .status(500)
        .json(Util.error({}, "Error deleting the user"));
    }
  }

  async getUserById(request: any, response: Response) {
    const { id } = request.user;
    try {
      const userData = await UserServices.getUserById(id);
      if (userData)
        return response
          .status(200)
          .json(Util.success(userData, "UserData fetched successfully"));
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error fetching the user"));
    }
  }
}

export default new UserHandler();
