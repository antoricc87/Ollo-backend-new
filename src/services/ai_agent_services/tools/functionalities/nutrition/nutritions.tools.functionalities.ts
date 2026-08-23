import OpenAI from "openai";
import { z } from "zod";
const apiKey = process.env.REACT_APP_OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: apiKey || "",
});

export const convertToLineItems = async (groceryListText: string) => {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: `
You are a grocery shopping assistant. Convert the following grocery list into structured JSON format.

Schema:
- name (string): The name of the grocery item
- line_item_measurements (array): [{"quantity": quantity,"unit":"string"}]
- filters (object): { brand_filters: [], health_filters: [] }

Rules:
- Parse measurements like (2 32oz) as quantity * unit (e.g., 64 oz).
- Use only these health filters if needed: ORGANIC, GLUTEN_FREE, FAT_FREE, VEGAN, KOSHER, SUGAR_FREE, LOW_FAT

Input:
${groceryListText}
      `,
    },
  ];

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "convertToLineItems",
        description: "Parses a grocery list into structured line items.",
        parameters: {
          type: "object",
          properties: {
            line_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  line_item_measurements: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        quantity: { type: "number" },
                        unit: { type: "string" },
                      },
                      required: ["quantity", "unit"],
                    },
                  },
                  filters: {
                    type: "object",
                    properties: {
                      brand_filters: {
                        type: "array",
                        items: { type: "string" },
                      },
                      health_filters: {
                        type: "array",
                        items: {
                          type: "string",
                          enum: [
                            "ORGANIC",
                            "GLUTEN_FREE",
                            "FAT_FREE",
                            "VEGAN",
                            "KOSHER",
                            "SUGAR_FREE",
                            "LOW_FAT",
                          ],
                        },
                      },
                    },
                    required: ["brand_filters", "health_filters"],
                  },
                },
                required: ["name", "line_item_measurements", "filters"],
              },
            },
          },
          required: ["line_items"],
        },
      },
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    tools,
    tool_choice: {
      type: "function",
      function: { name: "convertToLineItems" },
    },
  });

  const toolCall = response.choices[0].message.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("No structured output returned");
  }

  const parsed = JSON.parse(toolCall.function.arguments);

  return parsed;
};
