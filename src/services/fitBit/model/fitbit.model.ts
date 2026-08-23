import fetch from "node-fetch";
import crypto from "crypto";
import {
  formattedDateDaysAgo,
  formattedTodayDate,
} from "../../../utils/formatDate";

class FitbitHandler {
  clientId: string;
  clientSecret: string;
  redirectUri: string;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  generateRandomString(length: number): string {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let result = "";
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  base64UrlEncode(buffer: Buffer): string {
    return buffer
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  async generateCodeChallenge(codeVerifier: string): Promise<string> {
    console.log(codeVerifier);
    const hash = crypto.createHash("sha256").update(codeVerifier).digest();
    return this.base64UrlEncode(hash);
  }

  getAuthorizationUrl(codeChallenge: string): string {
    const codeChallengeMethod = "S256";
    const scopes = [
      "profile",
      "activity",
      "nutrition",
      "heartrate",
      "weight",
      "sleep",
      "social",
      "settings",
      "location",
      "oxygen_saturation",
      "respiratory_rate",
      "temperature",
      "cardio_fitness",
      "electrocardiogram",
    ];
    return `https://www.fitbit.com/oauth2/authorize?response_type=code&client_id=${
      this.clientId
    }&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${scopes.join(
      "%20"
    )}&code_challenge=${codeChallenge}&code_challenge_method=${codeChallengeMethod}`;
  }

  async exchangeCodeForToken(code: string, codeVerifier: string): Promise<any> {
    const response = await fetch("https://api.fitbit.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
            "base64"
          ),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
        code: code,
        code_verifier: codeVerifier,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Error exchanging code for token:", data);
    }
    return data;
  }

  async getUserProfile(
    accessToken: string,
    userId: string = "-"
  ): Promise<any> {
    const response = await fetch(
      `https://api.fitbit.com/1/user/${userId}/profile.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Error fetching user profile:", data);
    }
    return data;
  }

  async getHeartRate(accessToken: string, userId: string = "-"): Promise<any> {
    const response = await fetch(
      `https://api.fitbit.com/1/user/${userId}/activities/heart/date/today/7d.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Error fetching heart rate data:", data);
    }
    return data;
  }

  async getWeight(accessToken: string, userId: string = "-"): Promise<any> {
    const response = await fetch(
      `https://api.fitbit.com/1/user/${userId}/body/weight/date/today/7d.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Error fetching weight data:", data);
    }
    return data;
  }

  async getSleep(accessToken: string, userId: string = "-"): Promise<any> {
    const date = new Date();
    const todayDate = formattedTodayDate(date);
    const startingDate = formattedDateDaysAgo(7);
    const response = await fetch(
      `https://api.fitbit.com/1.2/user/${userId}/sleep/date/${startingDate}/${todayDate}.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Error fetching sleep data:", data);
    }
    return data;
  }
  async getBreathing(accessToken: string, userId: string = "-"): Promise<any> {
    const date = new Date();
    const todayDate = formattedTodayDate(date);
    const startingDate = formattedDateDaysAgo(7);
    const response = await fetch(
      `https://api.fitbit.com/1/user/${userId}/br/date/${startingDate}/${todayDate}.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Error fetching sleep data:", data);
    }
    return data;
  }
  async getHeartRateVariability(
    accessToken: string,
    userId: string = "-"
  ): Promise<any> {
    const date = new Date();
    const todayDate = formattedTodayDate(date);
    const startingDate = formattedDateDaysAgo(7);
    const response = await fetch(
      `https://api.fitbit.com/1/user/${userId}/hrv/date/${startingDate}/${todayDate}.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Error fetching sleep data:", data);
    }
    return data;
  }
  async getCardioScore(
    accessToken: string,
    userId: string = "-"
  ): Promise<any> {
    const date = new Date();
    const todayDate = formattedTodayDate(date);
    const startingDate = formattedDateDaysAgo(7);
    const response = await fetch(
      `https://api.fitbit.com/1/user/${userId}/cardioscore/date/${startingDate}/today.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Error fetching sleep data:", data);
    }
    return data;
  }
}

export default FitbitHandler;
