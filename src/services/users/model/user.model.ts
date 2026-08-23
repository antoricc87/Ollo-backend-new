import { Role } from "@prisma/client";
import { UserRegisterRequest } from "../../../types";
import prisma from "../../../utility/prismaClient";
import bcrypt from "bcryptjs";
import { signDoctorJWT, updateUserToken } from "../../../utils/auth_token";

export class UserServices {
  async createUser(userData: UserRegisterRequest) {
    try {
      const isDoctor = userData?.role?.toUpperCase?.() === "DOCTOR";
      if (isDoctor) {
        const isAuthorizedPhysician =
          await prisma.authorizedPhysicians.findUnique({
            where: {
              email: userData.email,
            },
          });
        if (!isAuthorizedPhysician) {
          throw new Error(
            "This email is not listed in our authorized physicians. Please contact Ollo to register."
          );
        }
        const existingUserWithNpi = await prisma.user.findUnique({
          where: { npiNumber: userData.npiNumber },
        });
        if (existingUserWithNpi) {
          throw new Error("User with this NPI Number already exists");
        }
        const existingUserWithLicense = await prisma.user.findUnique({
          where: { licenseNumber: userData.licenseNumber },
        });
        if (existingUserWithLicense) {
          throw new Error("User with this License Number already exists");
        }
        const existingUserWithEmail = await prisma.user.findUnique({
          where: { email: userData.email },
        });
        if (existingUserWithEmail) {
          throw new Error("User with this email already exists");
        }
      } else {
        const existingUser = await prisma.user.findUnique({
          where: { email: userData.email },
        });
        if (existingUser) {
          throw new Error("User with this email already exists");
        }
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(userData.password, salt);

      const normalizedRole = userData.role.toUpperCase() as Role;
      if (!Object.values(Role).includes(normalizedRole)) {
        throw new Error("Invalid role provided");
      }

      const updatedUserData = {
        ...userData,
        role: normalizedRole,
        password: hashedPassword,
      };

      const createdUser = await prisma.user.create({
        data: updatedUserData,
      });
      if (!createdUser) {
        throw new Error("User creation failed");
      }
      const token = await signDoctorJWT({ user: { id: createdUser.id } });
      await updateUserToken(createdUser.id, token);
      const { password: _, ...userWithoutPassword } = createdUser;

      const userDataNoPassword = {
        ...userWithoutPassword,
        token,
      };
      return { userDataNoPassword };
    } catch (error: unknown) {
      console.error("Error creating the user", error);
      throw error;
    }
  }

  async deleteUser(userId: string) {
    try {
      await prisma.userToken.deleteMany({
        where: { userId: userId },
      });
      const deletedUser = await prisma.user.delete({
        where: { id: userId },
      });
      if (deletedUser) return deletedUser;
    } catch (error: unknown) {
      console.error("Error deleting the user", error);
      throw error;
    }
  }

  async userLogin(email: string, password: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { email: email },
      });

      if (!user) {
        throw new Error("No account found with this email");
      }
      const matchingPassword = await bcrypt.compare(password, user.password);
      if (!matchingPassword) {
        throw new Error("Incorrect password");
      }
      const payload = { user: { id: user.id } };
      const token = await signDoctorJWT(payload);
      await updateUserToken(user.id, token);

      const { password: _, ...userWithoutPassword } = user;

      const userData = {
        ...userWithoutPassword,
        token,
      };
      return userData;
    } catch (error: unknown) {
      console.error("Error logging in the user", error);
      throw error;
    }
  }

  async getUserById(userId: string) {
    try {
      const userData = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!userData) {
        throw new Error("User with this id does not exists");
      }
      const { password: _, ...userDataNoPassword } = userData;
      return userDataNoPassword;
    } catch (error: unknown) {
      console.error("Error fetching user data", error);
      throw error;
    }
  }

  async updateUserPassword(id: string, data: object) {
    try {
      return await prisma.user.update({
        where: { id: id },
        data: data,
      });
    } catch (error: any) {
      console.error("Something went wrong updating the user password");
      return error;
    }
  }
}

export default new UserServices();
