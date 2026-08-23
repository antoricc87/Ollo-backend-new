import { Request, Response } from "express";
import DexcomService from "../model/dexcom.model";
import Util from "../../../utils/response";

class DexcomHandler {
  /**
   * Handles authentication requirement by returning JSON response instead of redirect
   * @param response - Express response object
   * @param userId - User ID for the auth URL
   * @param errorMessage - Optional error message to include
   */
  async handleAuthRequired(
    response: Response,
    userId: string,
    errorMessage?: string
  ) {
    try {
      const authUrl = DexcomService.getDexcomAuthUrl(userId);

      // Return JSON response instead of redirect for mobile apps
      return response.status(401).json({
        success: false,
        error: "AUTHENTICATION_REQUIRED",
        message: errorMessage || "Dexcom authentication required",
        authUrl: authUrl,
        code: "DEXCOM_REAUTH_NEEDED",
        requiresReauth: true,
      });
    } catch (error) {
      console.error("Error generating auth URL:", error);
      // Fallback response if Dexcom URL generation fails
      return response.status(500).json({
        success: false,
        error: "AUTH_URL_GENERATION_FAILED",
        message: "Failed to generate authentication URL",
        code: "DEXCOM_AUTH_FAILED",
      });
    }
  }

  getDexcomAuthToken = async (request: any, response: Response) => {
    const { id } = request.user;
    try {
      const authUrl = DexcomService.getDexcomAuthUrl(id);
      if (authUrl) {
        return response
          .status(200)
          .json(Util.success(authUrl, "Auth url successfully created"));
      } else {
        return response
          .status(500)
          .json(Util.error({}, "Failed to generate authorization URL"));
      }
    } catch (error: unknown) {
      console.error("Error generating Dexcom auth URL:", error);
      return response
        .status(500)
        .json(Util.error(error, "Internal Error, please try again"));
    }
  };

  // handleDexcomCallback = async (request: Request, response: Response) => {
  //   const { code, error, error_description, state } = request.query;

  //   if (error) {
  //     console.error("Dexcom OAuth error:", { error, error_description });
  //     const errorMessage =
  //       typeof error_description === "string"
  //         ? error_description
  //         : typeof error === "string"
  //         ? error
  //         : "Unknown error";

  //     // Return JSON response for mobile apps instead of redirect
  //     return response.status(400).json({
  //       success: false,
  //       error: "OAUTH_ERROR",
  //       message: errorMessage,
  //       code: "DEXCOM_OAUTH_FAILED",
  //     });
  //   }

  //   if (!code || typeof code !== "string") {
  //     return response.status(400).json({
  //       success: false,
  //       error: "MISSING_CODE",
  //       message: "Missing authorization code",
  //       code: "DEXCOM_CODE_MISSING",
  //     });
  //   }

  //   const userId = typeof state === "string" ? state : "sandbox-user"; // Replace with real user ID in production

  //   try {
  //     const tokenResponse = await DexcomService.exchangeCodeForToken(
  //       code,
  //       userId
  //     );

  //     // Return success response instead of redirect
  //     return response.status(200).json({
  //       success: true,
  //       message: "Dexcom authentication successful",
  //       code: "DEXCOM_AUTH_SUCCESS",
  //       data: tokenResponse,
  //     });
  //   } catch (err: any) {
  //     console.error("Dexcom token exchange failed:", err);

  //     return response.status(500).json({
  //       success: false,
  //       error: "TOKEN_EXCHANGE_FAILED",
  //       message: "Token exchange failed",
  //       code: "DEXCOM_TOKEN_FAILED",
  //       details: err.message,
  //     });
  //   }
  // };

  handleDexcomCallback = async (request: Request, response: Response) => {
    const { code, error, error_description, state } = request.query;

    const deepLinkSuccess = "ollohealth://testing/dexcomaccess?status=success";
    const deepLinkErrorBase = "ollohealth://dexcom-error?message=";

    // Helper to send a minimal HTML page that auto-redirects to the deep link
    const redirectWithHtml = (targetUrl: string) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return response.send(`<!doctype html>
  <html>
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Returning to Ollo Health…</title></head>
  <body>
    <p>Returning to Ollo Health…</p>
    <script>
      (function () {
        var url = ${JSON.stringify(targetUrl)};
        // Try deep link
        window.location.href = url;
        // Fallback: close this tab after a moment
        setTimeout(function(){ window.close && window.close(); }, 800);
      })();
    </script>
  </body>
  </html>`);
    };

    // OAuth error from Dexcom (user cancelled, denied, etc.)
    if (error) {
      const msg =
        typeof error_description === "string"
          ? error_description
          : typeof error === "string"
          ? error
          : "Authorization failed";
      return redirectWithHtml(`${deepLinkErrorBase}${encodeURIComponent(msg)}`);
    }

    if (!code || typeof code !== "string") {
      return redirectWithHtml(
        `${deepLinkErrorBase}${encodeURIComponent(
          "Missing authorization code"
        )}`
      );
    }

    // Prefer your own user resolution; state can carry a userId if you set it when building the auth URL
    const userId = typeof state === "string" ? state : "sandbox-user";

    try {
      await DexcomService.exchangeCodeForToken(code, userId);

      // ✅ Success → deep link back into the app/screen that initiated auth
      return redirectWithHtml(deepLinkSuccess);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error_description ||
        err?.response?.data?.error ||
        err?.message ||
        "Token exchange failed";
      return redirectWithHtml(`${deepLinkErrorBase}${encodeURIComponent(msg)}`);
    }
  };

  fetchDexcomEGVS = async (request: any, response: Response) => {
    const { id } = request.user;
    const { startDate, endDate } = request.body;

    try {
      const egvs = await DexcomService.getDexcomEGVS(id, startDate, endDate);
      if (egvs) {
        return response
          .status(200)
          .json(Util.success(egvs, "EGVS fetched successfully"));
      }
    } catch (error: any) {
      console.error("Error in fetchDexcomEGVS:", error);

      // Check if the error indicates authentication is required
      const errorMessage = error.message || "";
      const isAuthError =
        errorMessage.includes("re-authenticate") ||
        errorMessage.includes("token has expired") ||
        errorMessage.includes("invalid or expired") ||
        errorMessage.includes("No Dexcom token found") ||
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("401");

      if (isAuthError) {
        // Return JSON response instead of redirect
        return this.handleAuthRequired(response, id, errorMessage);
      }

      return response.status(500).json(
        Util.error(
          {
            message: error.message,
            details: error.response?.data || error.stack,
          },
          "Error fetching egvs"
        )
      );
    }
  };

  /**
   * Manually refresh Dexcom token
   * @param request - Express request object
   * @param response - Express response object
   */
  refreshDexcomToken = async (request: any, response: Response) => {
    const { id } = request.user;
    try {
      const refreshResult = await DexcomService.refreshDexcomToken(id);
      return response
        .status(200)
        .json(Util.success(refreshResult, "Token refreshed successfully"));
    } catch (error: any) {
      console.error("Error in refreshDexcomToken:", error);

      // Check if the error indicates authentication is required
      const errorMessage = error.message || "";
      const isAuthError =
        errorMessage.includes("re-authenticate") ||
        errorMessage.includes("invalid or expired") ||
        errorMessage.includes("No Dexcom token found") ||
        errorMessage.includes("No refresh token available") ||
        errorMessage.includes("unauthorized") ||
        errorMessage.includes("401");

      if (isAuthError) {
        // Return JSON response instead of redirect
        return this.handleAuthRequired(response, id, errorMessage);
      }

      return response.status(500).json(
        Util.error(
          {
            message: error.message,
            details: error.response?.data || error.stack,
          },
          "Error refreshing token"
        )
      );
    }
  };
}

export default new DexcomHandler();
