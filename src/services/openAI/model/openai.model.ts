// openaiService.ts
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import dotenv from "dotenv";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import OpenAI from "openai";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { promisify } from "util";
import {
  analyzeMeal,
  toLegacySingleMeal,
} from "../../meal_analysis/mealAnalysis.service";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
dotenv.config();

const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
const openai = new OpenAI({
  apiKey: apiKey || "",
});

// ---------------------------------------------------------------------------
// Meal analysis. The calorie entry points delegate to the unified analyzeMeal
// service. (The old MEAL_ANALYSIS_ENGINE=legacy prompts were deleted Oct 19 2026 —
// never set in production, and on retired gpt-4o models.)
// ---------------------------------------------------------------------------
/** App: typed description → single-meal shape `{ meals: Ingredient[], mealName, mealType }`. */
export const getOpenAiCaloriesCalculator = async (
  foodDescription: string,
  patientId: string
) => {
  const result = await analyzeMeal({ text: foodDescription }, { patientId });
  return toLegacySingleMeal(result);
};

/** App: meal photo (data URL) + optional caption → single-meal shape. */
export const getCaloriesFromImage = async (
  base64Image: string,
  description: string,
  patientId: string
) => {
  const result = await analyzeMeal(
    { imageDataUrl: base64Image, caption: description },
    { patientId }
  );
  return toLegacySingleMeal(result);
};

/** App: voice note → transcript → single-meal shape (transcript echoed back). */
export const getCaloriesFromAudio = async (
  base64Audio: string,
  patientId: string
) => {
  const transcript = await speechToText(base64Audio);
  const result = await analyzeMeal({ text: transcript }, { patientId });
  return { ...toLegacySingleMeal(result), transcript };
};

/** ~0.8 s of AAC at the app's HIGH_QUALITY preset. */
const MIN_AUDIO_BYTES = 8000;

/**
 * whisper-1, not gpt-4o-transcribe (Sep 22 2026). On real voice notes the
 * gpt-4o models are LLMs that sometimes stop after the first sentence (2 of 3
 * runs on a 13 s clip with pauses, 3 of 3 with a prompt) and once ANSWERED the
 * request instead of transcribing it (288 words of Italian coaching). whisper-1
 * was complete on every run and as accurate. It reads only the last 224 prompt
 * tokens, so the earlier-text tail sits last in the prompt.
 */
const TRANSCRIBE_MODEL = "whisper-1";

/** Containers the transcription endpoint decodes natively — no re-encode. */
const DIRECT_AUDIO_EXTENSIONS = new Set(["m4a", "mp3", "mp4", "wav", "webm", "ogg", "oga", "flac", "mpeg", "mpga"]);

const DATA_URL_PREFIX = /^data:audio\/([\w.+-]+);base64,/;

const transcribeFile = async (filePath: string, prompt?: string) => {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: TRANSCRIBE_MODEL,
    // A prompt is context, not instructions: the model continues it as if it
    // were earlier speech, which biases spelling toward the words it names.
    // On near-silent clips it can echo the prompt back (seen 2026-08-26) —
    // `echoesPrompt` below rejects that.
    ...(prompt ? { prompt } : {}),
  });
  return (transcription.text ?? "").trim();
};

const PROMPT_LEAD = "Talking to Ollie, my health coach";

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * True when the "transcript" is the prompt read back: a run of its words
 * (silence echo) or its opening line. A real sentence that merely uses the
 * hinted words ("Greek yogurt and oatmeal") passes. Against the earlier
 * transcript only long runs count — people do repeat themselves.
 */
const echoesPrompt = (text: string, prompt: { hints?: string; previous?: string }) => {
  const said = words(text);
  const run = said.join(" ");
  if (prompt.hints && ((said.length >= 3 && words(prompt.hints).join(" ").includes(run)) || run.includes(words(PROMPT_LEAD).join(" ")))) return true;
  return !!prompt.previous && said.length >= 10 && words(prompt.previous).join(" ").includes(run);
};

/**
 * The transcription prompt: likely words (spelling bias) and, for a segment of
 * a longer voice note, the text so far — the model continues it as context.
 */
export const transcriptionPrompt = (hints: string[], previous = "") => {
  const parts = {
    hints: hints.length ? `${PROMPT_LEAD}, about food, workouts, sleep and labs: ${hints.join(", ")}.` : undefined,
    previous: previous.trim() ? previous.trim().slice(-400) : undefined,
  };
  const text = [parts.hints, parts.previous].filter(Boolean).join("\n");
  return text ? { ...parts, text } : undefined;
};

export const speechToText = async (base64Audio: string, opts: { prompt?: ReturnType<typeof transcriptionPrompt>; minBytes?: number } = {}) => {
  const tempId = randomUUID();
  const mime = DATA_URL_PREFIX.exec(base64Audio)?.[1]?.toLowerCase();
  const ext = mime === "mpeg" ? "mp3" : mime === "x-m4a" ? "m4a" : (mime ?? "m4a");
  const direct = DIRECT_AUDIO_EXTENSIONS.has(ext);
  const tempRawPath = path.join(os.tmpdir(), `ollo-audio-${tempId}.${direct ? ext : "raw"}`);
  const tempConvertedPath = path.join(os.tmpdir(), `ollo-audio-${tempId}.mp3`);
  try {
    const audioBuffer = Buffer.from(base64Audio.replace(DATA_URL_PREFIX, ""), "base64");
    // A tap-tap on the mic yields a few KB of silence; the transcription model
    // then hallucinates a greeting in a random language. Refuse it up front.
    if (audioBuffer.length < (opts.minBytes ?? MIN_AUDIO_BYTES)) throw new Error("Recording too short");
    await writeFile(tempRawPath, audioBuffer);

    let text: string;
    try {
      // The app records AAC in an .m4a container, which the endpoint decodes
      // itself — send it untouched (the old ffmpeg → mp3 hop was lossy).
      if (!direct) throw new Error(`unsupported container: ${ext}`);
      text = await transcribeFile(tempRawPath, opts.prompt?.text);
    } catch (error: unknown) {
      // Unknown or corrupt container: re-mux to mp3 with ffmpeg and retry once.
      const message = error instanceof Error ? error.message : String(error);
      if (direct && !/format|decod|corrupt|unsupported|invalid/i.test(message)) throw error;
      await new Promise<void>((resolve, reject) => {
        ffmpeg(tempRawPath)
          .toFormat("mp3")
          .on("error", reject)
          .on("end", resolve)
          .save(tempConvertedPath);
      });
      text = await transcribeFile(tempConvertedPath, opts.prompt?.text);
    }
    // No Latin letters or digits at all = nothing intelligible was said.
    if (!/[A-Za-z0-9À-ÿ]/.test(text)) throw new Error("Nothing intelligible in the recording");
    if (opts.prompt && echoesPrompt(text, opts.prompt)) throw new Error("Nothing intelligible in the recording");
    return text;
  } catch (error: unknown) {
    console.error("Error transcribing the audio", error);
    throw error;
  } finally {
    await unlink(tempRawPath).catch(() => {});
    await unlink(tempConvertedPath).catch(() => {});
  }
};



