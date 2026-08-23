import express, { Request, Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../utility/prismaClient";
import { RegisterRequest } from "../types";

const router = express.Router();

// Register
router.post("/register", async (req: RegisterRequest, res: Response) => {
  const { username, email, password, specialty } = req.body;
  try {
    let user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      return res.status(400).json({ msg: "User already exists" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        specialty,
      },
    });
    const payload = { user: { id: user.id } };
    jwt.sign(payload, "secret", { expiresIn: 3600 }, (err, token) => {
      if (err) throw err;
      res.json({ token });
    });
  } catch (err: any) {
    console.error("Error during user registration:", err.message);
    res.status(500).send("Server error");
  }
});

interface LoginRequest extends Request {
  body: {
    email: string;
    password: string;
  };
}

// Login
router.post("/login", async (req: LoginRequest, res: Response) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid credentials" });
    }
    const payload = { user: { id: user.id } };
    jwt.sign(payload, "secret", { expiresIn: 3600 }, (err, token) => {
      if (err) throw err;
      res.json({ token });
    });
  } catch (err: any) {
    console.error("Error during user login:", err.message);
    res.status(500).send("Server error");
  }
});

export default router;
