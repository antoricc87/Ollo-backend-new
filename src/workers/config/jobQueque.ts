import { Queue } from "bullmq";

const connection = {
  host: process.env.REDIS_HOST,
  port: 6379,
  password: process.env.REDIS_PASSWORD,
};

export const jobQueue = new Queue("taskQueue", { connection });
