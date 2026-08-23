import { ChatOpenAI } from "@langchain/openai";
import { getSubAccounts } from "../../../patient/model/patient.model";

/**
 * LLM-based sub-account detection for meal logging queries
 * This uses an LLM to intelligently detect sub-account references instead of pattern matching
 */
export class LLMSubAccountDetector {
  private llm: any;

  constructor() {
    this.llm = new ChatOpenAI({
      openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.1,
    });
  }

  /**
   * Detects sub-account references in user queries using LLM
   * @param userQuery - The user's query text
   * @param parentPatientId - The ID of the parent patient
   * @returns Object with detected sub-account info and cleaned query
   */
  async detectSubAccountInQuery(
    userQuery: string,
    parentPatientId: string
  ): Promise<{
    targetPatientId: string | null;
    subAccountName: string | null;
    cleanedQuery: string;
    isSubAccountQuery: boolean;
    confidence: number;
    dateReference: string | null;
    dateConfidence: number;
  }> {
    try {
      // Get all sub-accounts for the parent patient
      const subAccounts = await getSubAccounts(parentPatientId);

      if (!subAccounts || subAccounts.length === 0) {
        return {
          targetPatientId: null,
          subAccountName: null,
          cleanedQuery: userQuery,
          isSubAccountQuery: false,
          confidence: 0,
          dateReference: null,
          dateConfidence: 0,
        };
      }

      // Create a list of sub-account names for the LLM
      const subAccountNames = subAccounts.map((account) => ({
        id: account.id,
        firstName: account.firstName,
        lastName: account.lastName,
        fullName: `${account.firstName} ${account.lastName}`.trim(),
      }));

      // Create the prompt for the LLM
      const prompt = this.createDetectionPrompt(userQuery, subAccountNames);

      // Call the LLM
      const response = await this.llm.invoke(prompt);
      const result = this.parseLLMResponse(response.content as string);

      // If a sub-account was detected, clean the query
      let cleanedQuery = userQuery;
      if (result.isSubAccountQuery && result.subAccountName) {
        cleanedQuery = this.cleanQueryFromName(
          userQuery,
          result.subAccountName
        );
      }

      return {
        targetPatientId: result.targetPatientId,
        subAccountName: result.subAccountName,
        cleanedQuery: cleanedQuery,
        isSubAccountQuery: result.isSubAccountQuery,
        confidence: result.confidence,
        dateReference: result.dateReference,
        dateConfidence: result.dateConfidence,
      };
    } catch (error) {
      console.error("Error in LLM sub-account detection:", error);
      return {
        targetPatientId: null,
        subAccountName: null,
        cleanedQuery: userQuery,
        isSubAccountQuery: false,
        confidence: 0,
        dateReference: null,
        dateConfidence: 0,
      };
    }
  }

  private createDetectionPrompt(
    userQuery: string,
    subAccountNames: any[]
  ): string {
    const namesList = subAccountNames
      .map((account) => `- ${account.fullName} (ID: ${account.id})`)
      .join("\n");

    return `You are an AI assistant that detects sub-account references in meal logging queries.

**User Query:** "${userQuery}"

**Available Sub-Accounts:**
${namesList}

**IMPORTANT - Context Detection for "Ollie":**
- "Ollie" can refer to either the AI assistant OR a sub-account
- **AI Assistant Context**: "Hey Ollie" + main user action ("log me", "I ate", "I had") - these are addressing the AI assistant about the main user
- **Sub-Account Context**: "Ollie had", "Ollie ate", "Ollie's meal", "log for Ollie", "Ollie's breakfast" - these refer to a person named Ollie
- **Mixed Context**: "Hey Ollie, log this for [NAME]" - addressing AI assistant but logging for someone else
- **Other AI Assistant Names**: "AI", "assistant", "bot", "robot" - always ignore these

**Task:** Analyze the query and determine:
1. Is this a meal logging query? (look for words like "ate", "had", "breakfast", "lunch", "dinner", "snack", "log meal", etc.)
2. Does it mention a specific person's name that matches one of the sub-accounts?
3. If yes, which sub-account is being referenced?
4. **Does it contain any date/time references?** Look for: yesterday, today, tomorrow, Monday, Tuesday, etc., last week, 2 days ago, specific dates like 12/25/2023, etc.

**Instructions:**
- Look for names, nicknames, or references to people in the query
- Match them to the available sub-accounts (consider variations like "Tommy" for "Thomas")
- Consider context clues like "my son", "my daughter", "my child" followed by names
- Be flexible with name matching (Tommy/Thomas, Mike/Michael, etc.)
- **CRITICAL: Context Detection for "Ollie":**
  - If "Ollie" appears in AI assistant context ("Hey Ollie" + main user action like "log me", "I ate"), treat as regular meal logging for main user
  - If "Ollie" appears in sub-account context ("Ollie had", "Ollie ate", "Ollie's meal"), check if "Ollie" exists in available sub-accounts
  - If "Ollie" is in sub-account context AND exists in sub-accounts list, treat as sub-account query
  - If "Ollie" is in sub-account context but NOT in sub-accounts list, treat as regular meal logging for main user
  - **MIXED CONTEXT**: If query has "Hey Ollie" + "for [NAME]" or "log this for [NAME]", ignore the "Hey Ollie" part and focus on the actual target person
- **For date detection**: Extract the exact date reference as it appears in the text (e.g., "yesterday", "Monday", "2 days ago", "last Friday")
- If multiple date references exist, use the most specific one
- If no date reference is found, set dateReference to null

**Response Format (JSON only):**
{
  "isMealLoggingQuery": boolean,
  "isSubAccountQuery": boolean,
  "targetPatientId": "sub-account-id-or-null",
  "subAccountName": "detected-name-or-null",
  "confidence": number (0-1),
  "dateReference": "exact-date-reference-or-null",
  "dateConfidence": number (0-1),
  "reasoning": "brief explanation"
}

**Examples:**
- "Tommy had breakfast" → isSubAccountQuery: true, targetPatientId: "thomas-id", subAccountName: "Tommy", dateReference: null
- "Yesterday Tommy ate breakfast" → isSubAccountQuery: true, targetPatientId: "thomas-id", subAccountName: "Tommy", dateReference: "yesterday"
- "Monday I ate lunch" → isSubAccountQuery: false, targetPatientId: null, dateReference: "Monday"
- "Log meal for Sarah" → isSubAccountQuery: true, targetPatientId: "sarah-id", subAccountName: "Sarah", dateReference: null
- "Hey Ollie, log me breakfast" → isSubAccountQuery: false, targetPatientId: null, subAccountName: null, dateReference: null (Ollie is AI assistant, main user action)
- "Ollie, can you help me" → isSubAccountQuery: false, targetPatientId: null, subAccountName: null, dateReference: null (Ollie is AI assistant)
- "Hey Ollie, log this for Tommy" → isSubAccountQuery: true, targetPatientId: "tommy-id", subAccountName: "Tommy", dateReference: null (mixed context - ignore "Hey Ollie", focus on Tommy)
- "Hey Ollie, log meal for Sarah" → isSubAccountQuery: true, targetPatientId: "sarah-id", subAccountName: "Sarah", dateReference: null (mixed context - ignore "Hey Ollie", focus on Sarah)
- "Ollie had breakfast" → Check if "Ollie" exists in sub-accounts:
  - If "Ollie" exists in sub-accounts → isSubAccountQuery: true, targetPatientId: "ollie-id", subAccountName: "Ollie", dateReference: null
  - If "Ollie" NOT in sub-accounts → isSubAccountQuery: false, targetPatientId: null, subAccountName: null, dateReference: null
- "Ollie's meal was logged" → Check if "Ollie" exists in sub-accounts:
  - If "Ollie" exists in sub-accounts → isSubAccountQuery: true, targetPatientId: "ollie-id", subAccountName: "Ollie", dateReference: null
  - If "Ollie" NOT in sub-accounts → isSubAccountQuery: false, targetPatientId: null, subAccountName: null, dateReference: null`;
  }

  private parseLLMResponse(response: string): any {
    try {
      // Extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in LLM response");
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isSubAccountQuery: parsed.isSubAccountQuery || false,
        targetPatientId: parsed.targetPatientId || null,
        subAccountName: parsed.subAccountName || null,
        confidence: parsed.confidence || 0,
        dateReference: parsed.dateReference || null,
        dateConfidence: parsed.dateConfidence || 0,
        reasoning: parsed.reasoning || "",
      };
    } catch (error) {
      console.error("Error parsing LLM response:", error);
      return {
        isSubAccountQuery: false,
        targetPatientId: null,
        subAccountName: null,
        confidence: 0,
        dateReference: null,
        dateConfidence: 0,
        reasoning: "Failed to parse LLM response",
      };
    }
  }

  private cleanQueryFromName(
    originalQuery: string,
    detectedName: string
  ): string {
    // Remove the detected name from the query
    const regex = new RegExp(`\\b${detectedName}\\b`, "gi");
    return originalQuery.replace(regex, "").replace(/\s+/g, " ").trim();
  }
}

/**
 * Checks if a query contains meal logging keywords using LLM
 * @param userQuery - The user's query text
 * @returns boolean indicating if this is a meal logging request
 */
export async function isMealLoggingQueryLLM(
  userQuery: string
): Promise<boolean> {
  try {
    const llm = new ChatOpenAI({
      openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
      model: "gpt-4o-mini",
      temperature: 0.1,
    });

    const prompt = `Analyze this user query and determine if it's a meal logging request.

**Query:** "${userQuery}"

**Meal logging indicators include:**
- Direct food logging: "log meal", "log food", "track food", "record meal"
- Past tense eating: "ate", "had", "consumed"
- Meal times: "breakfast", "lunch", "dinner", "snack"
- Food descriptions with eating context

**Response:** Answer with only "true" or "false"`;

    const response = await llm.invoke(prompt);
    const result = (response.content as string).toLowerCase().trim();

    return result === "true";
  } catch (error) {
    console.error("Error in LLM meal logging detection:", error);
    // Fallback to simple keyword matching
    const queryLower = userQuery.toLowerCase();
    const mealKeywords = [
      "ate",
      "had",
      "breakfast",
      "lunch",
      "dinner",
      "snack",
      "log meal",
      "log food",
    ];
    return mealKeywords.some((keyword) => queryLower.includes(keyword));
  }
}
