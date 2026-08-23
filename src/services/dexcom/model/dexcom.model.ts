import axios from "axios";
import qs from "qs";
import prisma from "../../../utility/prismaClient";

class DexcomService {
  private validateEnvironmentVariables() {
    const requiredVars = [
      "DEXCOM_SANDBOX_BASE_URL",
      "DEXCOM_CLIENT_ID",
      "DEXCOM_CLIENT_SECRET",
      "DEXCOM_REDIRECT_URI",
    ];

    const missingVars = requiredVars.filter((varName) => !process.env[varName]);

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
    }
  }
  private async fetchDexcomToken(userId: string) {
    try {
      const dexcomToken = await prisma.dexcomToken.findUnique({
        where: { patientId: userId },
      });
      return dexcomToken;
    } catch (error: unknown) {
      console.error("Failed fetching token", error);
      throw error;
    }
  }
  getDexcomAuthUrl(userId?: string) {
    try {
      this.validateEnvironmentVariables();

      const baseUrl = process.env.DEXCOM_SANDBOX_BASE_URL!;
      const clientId = process.env.DEXCOM_CLIENT_ID!;
      const redirectUri = encodeURIComponent(process.env.DEXCOM_REDIRECT_URI!);

      const scope = "offline_access";
      const responseType = "code";
      const state = userId ? encodeURIComponent(userId) : "";

      return `${baseUrl}/v2/oauth2/login?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=${responseType}&scope=${scope}${
        state ? `&state=${state}` : ""
      }`;
    } catch (error: unknown) {
      console.error("Something went wrong during authorization", error);
      throw error;
    }
  }

  async refreshDexcomToken(userId: string) {
    try {
      this.validateEnvironmentVariables();

      const dexcomToken = await this.fetchDexcomToken(userId);

      if (!dexcomToken) {
        throw new Error("No Dexcom token found for this user");
      }

      if (!dexcomToken.refreshToken) {
        throw new Error("No refresh token available for this user");
      }

      const baseUrl = process.env.DEXCOM_SANDBOX_BASE_URL!;
      const tokenUrl = `${baseUrl}/v2/oauth2/token`;

      const requestData = {
        client_id: process.env.DEXCOM_CLIENT_ID!,
        client_secret: process.env.DEXCOM_CLIENT_SECRET!,
        refresh_token: dexcomToken.refreshToken,
        grant_type: "refresh_token",
      };

      const response = await axios.post(tokenUrl, qs.stringify(requestData), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      });

      const { access_token, refresh_token, expires_in } = response.data;

      if (!access_token) {
        throw new Error("No access token received from Dexcom refresh");
      }

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Update the token in the database
      await prisma.dexcomToken.update({
        where: {
          patientId: userId,
        },
        data: {
          accessToken: access_token,
          refreshToken: refresh_token || dexcomToken.refreshToken, // Use new refresh token if provided, otherwise keep the old one
          expiresAt: expiresAt,
        },
      });

      return {
        access_token,
        refresh_token: refresh_token || dexcomToken.refreshToken,
        expires_in,
        expires_at: expiresAt.toISOString(),
        user_id: userId,
      };
    } catch (error: any) {
      console.error("Dexcom token refresh error:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        config: {
          url: error.config?.url,
          method: error.config?.method,
        },
      });

      if (
        error.response?.status === 400 &&
        error.response?.data?.error === "invalid_grant"
      ) {
        throw new Error(
          "Refresh token is invalid or expired. Please re-authenticate."
        );
      }

      if (error.response?.data?.error) {
        throw new Error(`Dexcom API error: ${error.response.data.error}`);
      }

      throw error;
    }
  }
  async exchangeCodeForToken(code: string, userId: string) {
    try {
      this.validateEnvironmentVariables();

      // Use the same base URL as the auth URL for consistency
      const baseUrl = process.env.DEXCOM_SANDBOX_BASE_URL!;
      const tokenUrl = `${baseUrl}/v2/oauth2/token`;

      const requestData = {
        client_id: process.env.DEXCOM_CLIENT_ID!,
        client_secret: process.env.DEXCOM_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: process.env.DEXCOM_REDIRECT_URI!,
      };

      const response = await axios.post(tokenUrl, qs.stringify(requestData), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      });

      const { access_token, refresh_token, expires_in } = response.data;

      if (!access_token) {
        throw new Error("No access token received from Dexcom");
      }

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      await prisma.dexcomToken.upsert({
        where: { patientId: userId },
        update: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt,
        },
        create: {
          patientId: userId,
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt,
        },
      });

      return {
        access_token,
        refresh_token,
        expires_in,
        expires_at: expiresAt.toISOString(),
        user_id: userId,
      };
    } catch (error: any) {
      console.error("Dexcom token exchange error:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        config: {
          url: error.config?.url,
          method: error.config?.method,
        },
      });

      if (error.response?.data?.error) {
        throw new Error(`Dexcom API error: ${error.response.data.error}`);
      }

      throw error;
    }
  }

  async getDexcomEGVS(userId: string, startDate: string, endDate: string) {
    try {
      let dexcomToken = await this.fetchDexcomToken(userId);

      if (!dexcomToken) {
        throw new Error("No Dexcom token found for this user");
      }

      // Check if token is expired and try to refresh it
      const now = new Date();
      const expiresAt = new Date(dexcomToken.expiresAt);

      if (now > expiresAt) {
        try {
          console.log("Dexcom token expired, attempting to refresh...");
          const refreshResult = await this.refreshDexcomToken(userId);
          dexcomToken = await this.fetchDexcomToken(userId);
          console.log("Token refreshed successfully");
        } catch (refreshError) {
          throw new Error(
            "Dexcom token has expired and could not be refreshed. Please re-authenticate."
          );
        }
      }

      const query = new URLSearchParams({
        startDate: startDate,
        endDate: endDate,
      }).toString();

      const response = await axios.get(
        `https://sandbox-api.dexcom.com/v3/users/self/egvs?${query}`,
        {
          headers: {
            Authorization: `Bearer ${dexcomToken.accessToken}`,
            Accept: "application/json",
          },
        }
      );

      return response.data;
    } catch (error: any) {
      console.error("Failed fetching egvs:", {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        config: error.config,
      });

      if (error.response?.status === 401) {
        throw new Error(
          "Dexcom token is invalid or expired. Please re-authenticate."
        );
      }

      if (error.response?.status) {
        throw new Error(
          `Dexcom API error: ${error.response.status} - ${error.response.statusText}`
        );
      }

      throw new Error(`Failed to fetch EGVS: ${error.message}`);
    }
  }
}

export default new DexcomService();
