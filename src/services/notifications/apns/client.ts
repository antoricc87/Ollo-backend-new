import http2 from "http2";
import jwt from "jsonwebtoken";

/**
 * APNs over HTTP/2 with a provider token (JWT, ES256). No SDK: the protocol
 * is one POST per device and Apple's answers are a status code plus a small
 * JSON `reason`. The key is the team's `.p8`; one key serves every app in the
 * team and both environments.
 *
 * Env: APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8 (the PEM, either verbatim with
 * `\n` escapes or base64 of the whole file). Missing → `apnsConfigured()`
 * is false and callers mark rows `no_transport` instead of throwing.
 */

export type ApnsEnv = "production" | "sandbox";

const HOSTS: Record<ApnsEnv, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

/** Apple accepts a provider token for 60 minutes; refresh well inside that. */
const TOKEN_TTL_MS = 50 * 60 * 1000;

export type ApnsPayload = {
  aps: {
    alert: { title: string; body: string };
    sound?: string;
    badge?: number;
    "thread-id"?: string;
    "interruption-level"?: "passive" | "active" | "time-sensitive";
    "relevance-score"?: number;
  };
  [key: string]: unknown;
};

/** Flat on purpose: this tsconfig has no strictNullChecks, so a discriminated union does not narrow. */
export type ApnsResult = {
  ok: boolean;
  apnsId?: string;
  status?: number;
  reason?: string;
  /** The token is dead (410 Unregistered): disable the device. */
  unregistered?: boolean;
  /** 400 BadDeviceToken: the token belongs to the other environment (sandbox vs production). */
  wrongEnv?: boolean;
};

const loadKey = (): string | null => {
  const raw = process.env.APNS_KEY_P8;
  if (!raw) return null;
  if (raw.includes("BEGIN PRIVATE KEY")) return raw.replace(/\\n/g, "\n");
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return decoded.includes("BEGIN PRIVATE KEY") ? decoded : null;
  } catch {
    return null;
  }
};

export const apnsConfigured = (): boolean => !!(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && loadKey());

let cached: { token: string; at: number } | null = null;
const providerToken = (): string => {
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token;
  const key = loadKey();
  if (!key) throw new Error("APNs key not configured");
  const token = jwt.sign({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }, key, {
    algorithm: "ES256",
    header: { alg: "ES256", kid: process.env.APNS_KEY_ID as string },
  });
  cached = { token, at: Date.now() };
  return token;
};

/** Test seam: reset the cached provider token (and let tests inject a sender). */
export const _resetApnsCache = () => {
  cached = null;
};

/**
 * One push to one device. `topic` is the app's bundle id. `collapseId` lets a
 * later push replace an earlier one on the lock screen (same id).
 */
export async function sendApns(opts: {
  env: ApnsEnv;
  deviceToken: string;
  topic: string;
  payload: ApnsPayload;
  collapseId?: string;
  expiresInSeconds?: number;
}): Promise<ApnsResult> {
  const headers: Record<string, string> = {
    ":method": "POST",
    ":path": `/3/device/${opts.deviceToken}`,
    authorization: `bearer ${providerToken()}`,
    "apns-topic": opts.topic,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-expiration": String(Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 24 * 3600)),
  };
  if (opts.collapseId) headers["apns-collapse-id"] = opts.collapseId.slice(0, 64);

  return new Promise<ApnsResult>((resolve, reject) => {
    const client = http2.connect(HOSTS[opts.env]);
    const finish = (r: ApnsResult | Error) => {
      client.close();
      r instanceof Error ? reject(r) : resolve(r);
    };
    client.on("error", finish);
    const req = client.request(headers);
    let status = 0;
    let apnsId = "";
    const chunks: Buffer[] = [];
    req.on("response", (h) => {
      status = Number(h[":status"] ?? 0);
      apnsId = String(h["apns-id"] ?? "");
    });
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("error", finish);
    req.on("end", () => {
      if (status === 200) return finish({ ok: true, apnsId });
      let reason = "";
      try {
        reason = JSON.parse(Buffer.concat(chunks).toString("utf8")).reason ?? "";
      } catch {
        reason = `HTTP ${status}`;
      }
      finish({
        ok: false,
        status,
        reason,
        unregistered: status === 410 || reason === "Unregistered",
        wrongEnv: status === 400 && reason === "BadDeviceToken",
      });
    });
    req.setTimeout(10_000, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      finish(new Error("APNs request timed out"));
    });
    req.end(JSON.stringify(opts.payload));
  });
}
