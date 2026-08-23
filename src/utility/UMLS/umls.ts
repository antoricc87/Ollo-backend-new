import axios from "axios";
import * as cheerio from "cheerio";
import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: 6379,
  password: process.env.REDIS_PASSWORD,
});

const TGT_KEY = "umls:tgt";
const EXPIRATION_SECONDS = 8 * 60 * 60; // 8 hours

export async function getCachedTGT(): Promise<string | null> {
  return await redis.get(TGT_KEY);
}

export async function storeTGT(tgt: string) {
  await redis.set(TGT_KEY, tgt, "EX", EXPIRATION_SECONDS);
}

export const createNewTGT = async () => {
  try {
    const response = await axios.post(
      `https://utslogin.nlm.nih.gov/cas/v1/api-key`,
      new URLSearchParams({ apikey: process.env.UMLS_API_KEY }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (response.data) {
      const $ = cheerio.load(response.data);
      const formAction = $("form").attr("action");
      //   console.log(formAction);
      await storeTGT(formAction);
      return formAction;
    }

    throw new Error("No TGT form returned");
  } catch (error) {
    console.error("Error getting TGT", error);
    throw error;
  }
};

export const getSTcode = async () => {
  try {
    const TGT = await getCachedTGT();
    const response = await axios.post(
      `${TGT}`,
      new URLSearchParams({ service: "http://umlsks.nlm.nih.gov" }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    if (response.data) {
      return response.data;
    }
  } catch (error: unknown) {
    console.error("Error getting ST code", error);
    throw error;
  }
};

export const searchLabFromUMLS = async (word: string) => {
  try {
    const ST_Code = await getSTcode();
    const response = await axios.get(
      `https://uts-ws.nlm.nih.gov/rest/search/current?string=H${word}&ticket=${ST_Code}`
    );
    if (response.data) {
      console.log(response.data.result.results);
    }
  } catch (error: unknown) {
    console.error("Error searching the word", error);
    throw error;
  }
};
