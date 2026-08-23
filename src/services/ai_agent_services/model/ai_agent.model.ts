import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { Annotation, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import {
  FitnessFallbackTool,
  WorkoutPlanGeneratorTool,
} from "../tools/fitness.tools";
import {
  HealthFallbackTool,
  RecommendedTestGeneratorTool,
  RetrievePatientData,
} from "../tools/health.tools";
import {
  FallbackTool,
  GroceryListGeneratorTool,
  InstacartShoppingListTool,
  LogMealTool,
  MealPlanGeneratorTool,
  NutritionFeedbackTool,
  RecipeGeneratorTool,
  SingleMealGeneratorTool,
  SubAccountMealLoggingTool,
  MultiAccountMealPlanGeneratorTool,
} from "../tools/nutrition.tools";
import { HealthGoalAnalysisTool } from "../tools/health_goals.tools";
dotenv.config();

// Define an in-memory cache to store conversation state keyed by threadId
const nutritionConversationCache: Map<string, typeof GraphState.State> =
  new Map();
const fitnessConversationCache: Map<string, typeof GraphState.State> =
  new Map();

// Cache to track successful tool executions to prevent retries
const successfulToolExecutions: Map<
  string,
  { timestamp: number; result: string }
> = new Map();
// const healthConversationCache: Map<string, typeof GraphState.State> = new Map();
type HealthAgentState = {
  messages: (AIMessage | HumanMessage)[];
  isSymptomsMode?: boolean;
};
const healthConversationCache: Map<string, HealthAgentState> = new Map();

const MAX_MESSAGES = 15;

const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prevMessages, newMessages) =>
      [...prevMessages, ...newMessages].slice(-MAX_MESSAGES),
  }),
});

export const classifyQuery = async (query: string): Promise<boolean> => {
  const classificationModel = new ChatOpenAI({
    openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
    model: "gpt-4o-mini",
    temperature: 0.1,
  });

  const classificationPrompt = `Classify whether the user's message is about a symptom or not. Respond only with 'yes' or 'no'. \nUser: "${query}"`;

  // Use a simple string input instead of ChatPromptTemplate
  const result = await classificationModel.invoke(classificationPrompt);

  // Ensure result.content is always a string
  let response = "";
  if (typeof result.content === "string") {
    response = result.content.toLowerCase().trim();
  } else if (Array.isArray(result.content)) {
    response = result.content.join(" ").toLowerCase().trim();
  }

  return response === "yes";
};
export async function callGeneralAgent(
  query: string,
  thread_id: string,
  patientId: string
) {
  type NutritionAgentState = {
    messages: (AIMessage | HumanMessage)[];
  };
  // test
  let errorEncountered = false;
  console.log("General Cache: ", nutritionConversationCache.size);
  // Retrieve existing state if it exists; otherwise, start a new one
  let initialState: NutritionAgentState =
    nutritionConversationCache.get(thread_id);
  if (!initialState) {
    console.log(
      `🛑 No existing state for thread_id: ${thread_id}, initializing new conversation.`
    );
    initialState = {
      messages: [new HumanMessage(query)],
    };
  } else {
    // Append the new user message to the existing messages
    initialState.messages.push(new HumanMessage(query));
  }

  // Define tools
  const logMealTool = new LogMealTool(patientId);
  const tools = [
    new MealPlanGeneratorTool(patientId),
    new RecipeGeneratorTool(patientId),
    new GroceryListGeneratorTool(patientId),
    new NutritionFeedbackTool(patientId),
    new InstacartShoppingListTool(patientId),
    new WorkoutPlanGeneratorTool(patientId),
    new SingleMealGeneratorTool(patientId),
    new FallbackTool(patientId),
    new HealthGoalAnalysisTool(patientId),
    logMealTool,
    new SubAccountMealLoggingTool(patientId, logMealTool),
    new MultiAccountMealPlanGeneratorTool(patientId),
  ];
  const toolNode = new ToolNode<typeof GraphState.State>(tools);

  // Define the chat model
  const model = new ChatOpenAI({
    openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
    model: "gpt-4o-mini",
    temperature: 0.1,
  }).bindTools(tools);

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a helpful AI nutrition assistant named Ollie. Use tools to generate personalized recommendations.

      **Meal Planning Logic:**
      - If the user requests a **full-day meal plan or longer** (e.g., "generate a 1-day meal plan", "give me a 7-day meal plan"), **use the Meal Plan Generator**.
      - If the user asks for a **single meal recommendation** (e.g., "what can I eat for dinner?", "what should I have for breakfast?"), **use the Single Meal Generator**
      - If specified that meal plan is for more than one account use **MultiAccountMealPlanGeneratorTool**

      **Meal Logging Logic:**
      - If the user wants to **log meals, food entries, or favorite meals**, use the appropriate tool:
        - **Sub-Account Meal Logging Tool**: Use when the user mentions someone else's name in a meal logging context. This tool uses AI to intelligently detect sub-account references (e.g., "Tommy had breakfast", "log meal for Sarah", "my son ate...", "Thomas had eggs and sausages" these are examples do not always use these names in the query unless the user mentions them))
        - **Log Meal Tool**: Use for the main user's own meal logging (e.g., "I ate breakfast", "log my meal", "I had my favorite breakfast", "log my favorite lunch")
        - **IMPORTANT**: Context matters for "Ollie" - it can refer to either you (the AI assistant) or a sub-account:
          - **AI Assistant Context**: "Hey Ollie, log me...", "Ollie, can you...", "Ollie, I need..." → Use Log Meal Tool for main user
          - **Sub-Account Context**: "Ollie had...", "Ollie ate...", "Ollie's meal..." → Use Sub-Account Meal Logging Tool (if Ollie exists as sub-account)
          - **Mixed Context**: "Hey Ollie, log this for [NAME]" → Use Sub-Account Meal Logging Tool for the specified person (ignore "Hey Ollie" part)
      
      **Favorite Meal Detection:**
      - When user mentions **"my favorite breakfast/lunch/dinner"**, **"favorite meal"**, **"my usual meal"**, **"go-to meal"**, or **"saved meal"** - IMMEDIATELY use Log Meal Tool with containsFav=true
      - Examples: "log my favorite breakfast", "I had my favorite lunch", "can you log my usual dinner", "my go-to breakfast"
      
      **CRITICAL: Pure vs Mixed Query Classification:**
      - **PURE FAVORITE QUERIES** (use FAVORITE_MEAL prefix): Query contains ONLY favorite meal references
        - **Single favorite**: "log my favorite breakfast", "I had my favorite lunch"
        - **Multiple favorites**: "I had my favorite breakfast and my favorite lunch", "log my favorite breakfast and my usual dinner", "can you log me my favorite breakfast and my favorite lunch with rice, peas, and carrots"
        - Pattern: Only mentions "my favorite", "favorite", "my usual", "go-to", "saved meal" - NO specific food descriptions that are NOT favorite references
      - **MIXED QUERIES** (use MIXED_MEAL prefix): Query contains BOTH favorite meals AND regular meal descriptions
        - Examples: "I had my favorite breakfast and for lunch pasta carbonara", "Yesterday I had my favorite lunch and for dinner chicken salad"
        - Pattern: Mentions favorites AND specific food items that are NOT favorite references
      
      - The Log Meal Tool will automatically detect and use the saved favorite meal data
      - DO NOT ask for details - just log the favorite meal directly
      
      **MULTIPLE FAVORITE MEALS:**
      - When user requests multiple favorite meals in one query, ALWAYS use FAVORITE_MEAL prefix
      - Examples: "log my favorite breakfast and my favorite lunch", "I had my favorite breakfast and my usual dinner", "can you log me my favorite breakfast and my favorite lunch with rice, peas, and carrots"
      - These are PURE favorite queries, NOT mixed queries, even if they mention specific ingredients
      - The Log Meal Tool will detect and process ALL favorite meals in the query
      
      **IMPORTANT: Meal Batching for Efficiency:**
      - When logging multiple meals for the same day, ALWAYS batch them together in a single tool call
      - Example: If user says "Monday I had breakfast: eggs and bacon, lunch: chicken salad, dinner: salmon with potatoes" - call LogMealTool ONCE with the entire description
      - Mixed queries: If user says "Yesterday I had my favorite breakfast and for lunch pasta bolognese" - call LogMealTool with "MIXED_MEAL: Yesterday I had my favorite breakfast and for lunch pasta bolognese"
      - Pure favorite queries: If user says "Log my favorite breakfast and my favorite lunch" - call LogMealTool with "FAVORITE_MEAL: Log my favorite breakfast and my favorite lunch"
      - Pure favorite queries: If user says "Can you log me my favorite breakfast and my favorite lunch with rice, peas, and carrots?" - call LogMealTool with "FAVORITE_MEAL: Can you log me my favorite breakfast and my favorite lunch with rice, peas, and carrots?"
      - DO NOT make separate tool calls for each meal - this wastes tokens and is inefficient
      - The LogMealTool is designed to handle multiple meals in a single call, including favorite meals

      **Handling Other Requests:**
      - If a request involves grocery lists, recipes, or nutrition feedback, **always call the corresponding tool**.
      - If a request asks about **portion sizes** (e.g., "how much [food] can I eat?"), inform the user that there is a portion calculator tool in the previous screen.
      - If the request is about **remaining calories/macros** (e.g., "how many carbs do I have left?"), use the Fallback Tool.

      **Available Tools:**
      - **Meal Plan Generator**: Creates a **full-day or multi-day** meal plan.
      - **Single Meal Generator**: Provides a **single meal recommendation** (e.g., breakfast, lunch, dinner).
      - **Recipe Generator**: Provides step-by-step recipes.
      - **Grocery List Generator**: Generates grocery lists based on diet needs.
      - **Sub-Account Meal Logging Tool**: Uses AI to intelligently detect sub-account references and logs meals for them (use when names are mentioned).
      - **Log Meal Tool**: Logs meals for the main user, including favorite meals (automatically detects and uses saved favorite meal data).
      - **Nutrition Feedback Tool**: Analyzes and provides personalized feedback on user nutrition(to be used every time user asks for overall nutrition feedback not recommendations).
      - **Instacart Shopping List Generator**: Generates a shoppable Instacart link from a generated grocery list.
      - **Workout Plan Generator**: Generates personalized workout plans.
      - **Health goal feedback tool**: Analyzes and provides personalized feedback on in progress healthgoals.
      - **Fallback Tool**: Handles all queries when no specialized tool applies.
      **Tool Usage Guidelines:**
      - If a tool has been used, end your response with **[toolUsed:name_of_the_tool]** (do not include the word "append").
      - If NO tool has been used, **you MUST end your response with** [toolUsed:none] (do not include the word "append").
      - When a tool has been used, never incvlude the word append in your ending sentence.
      
      **CRITICAL: Log Meal Tool Parameter Format:**
      - For favorite meals: Pass as STRING "FAVORITE_MEAL: [ORIGINAL USER QUERY EXACTLY AS TYPED]"
      - For mixed queries: Pass as STRING "MIXED_MEAL: [ORIGINAL USER QUERY EXACTLY AS TYPED]"
      - For regular meals: Pass as STRING "[ORIGINAL USER QUERY EXACTLY AS TYPED]"
      - ALWAYS use string format with appropriate prefix for favorite meal detection
      - **DO NOT MODIFY, CLEAN, OR CHANGE the user's original query - pass it exactly as received**
      `,
    ],
    new MessagesPlaceholder("messages"),
  ]);

  // Function to process the conversation and generate a response
  async function callModel(state: NutritionAgentState) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (!lastMessage) {
      return { messages: [new AIMessage("⚠️ Something went wrong.")] };
    }

    const formattedPrompt = await prompt.invoke({
      system_message: "You are a helpful AI Primary Care Assistant",
      time: new Date().toISOString(),
      tool_names: tools.map((tool) => tool.name).join(", "),
      messages: state.messages,
    });

    // **Retry Mechanism**
    const maxRetries = 3;
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const result = await model.invoke(formattedPrompt);
        return { messages: [result] };
      } catch (error: any) {
        console.error(`❌ Error on attempt ${attempt + 1}:`, error);

        // Check if this is a tool parameter mismatch error
        if (
          error.message &&
          error.message.includes(
            "messages with role 'tool' must be a response to a preceeding message with 'tool_calls'"
          )
        ) {
          console.log(
            "🔧 Detected tool parameter mismatch, checking if tool was actually successful..."
          );

          // Check if we have a successful tool execution in the conversation
          const toolMessages = state.messages.filter(
            (msg) => msg.getType() === "tool"
          );

          if (toolMessages.length > 0) {
            const lastToolMessage = toolMessages[toolMessages.length - 1];

            if (
              lastToolMessage &&
              typeof lastToolMessage.content === "string"
            ) {
              const toolContent = lastToolMessage.content;
              const successIndicators = [
                "All good, I have logged",
                "meal(s) for",
                "Meal already logged successfully",
                "logged successfully",
              ];

              const isSuccessful = successIndicators.some((indicator) =>
                toolContent.toLowerCase().includes(indicator.toLowerCase())
              );

              if (isSuccessful) {
                console.log(
                  "🎯 Tool was actually successful despite parameter mismatch, returning success message"
                );
                const genericSuccessMessage =
                  "I have successfully logged all your meals. Your nutrition data has been updated.";
                return { messages: [new AIMessage(genericSuccessMessage)] };
              }
            }
          }
        }

        attempt++;
        if (attempt === maxRetries) {
          errorEncountered = true;
          return {
            messages: [new AIMessage("I'm sorry, something went wrong.")],
          };
        }
      }
    }
  }

  function shouldContinue(state: NutritionAgentState) {
    console.log("🔍 Checking General agent shouldContinue condition...");

    if (!state.messages || state.messages.length === 0) {
      return "fallback";
    }

    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    // ✅ Exit properly if a tool was used
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      console.log("✅ Tool was used, continuing...");
      return "tools";
    }

    // ✅ Exit if the message has a valid response
    if (
      typeof lastMessage.content === "string" &&
      lastMessage.content.length > 0
    ) {
      console.log("✅ Valid response received, stopping agent.");
      return "__end__";
    }

    return "fallback";
  }

  // Set up the workflow
  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("fallback", new FallbackTool(patientId))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent")
    .addEdge("fallback", "__end__");

  const app = workflow.compile();

  // Execute the workflow
  const finalState = await app.invoke(initialState, {
    recursionLimit: 15,
    configurable: { thread_id },
  });

  // Validate and update the conversation cache
  if (!finalState.messages || finalState.messages.length === 0) {
    console.warn(
      `⚠️ AI returned an empty state, resetting cache for thread_id: ${thread_id}`
    );
    nutritionConversationCache.delete(thread_id);
  } else {
    nutritionConversationCache.set(thread_id, finalState);
  }

  // Extract AI's response and tool usage
  const aiMessages = finalState.messages.filter(
    (msg) => msg instanceof AIMessage
  );
  const lastAIMessage = aiMessages[aiMessages.length - 1] as AIMessage;

  // Ensure valid AI response
  const lastMessageContent =
    lastAIMessage?.content && typeof lastAIMessage.content === "string"
      ? lastAIMessage.content
      : "⚠️ No valid AI response generated.";

  // Extract tool usage
  const toolUsagePattern = /\[toolUsed:([^\]]+)\]/;
  const toolMatch = lastMessageContent.match(toolUsagePattern);
  const toolUsed = toolMatch !== null ? toolMatch[1] : "none";

  // Remove toolUsed tag from response
  const result = lastMessageContent.replace(toolMatch?.[0] ?? "", "").trim();

  console.log("🤖 Final AI Response:", result);

  return {
    threadId: thread_id,
    result: result.length > 0 ? result : "⚠️ No valid AI response.",
    errorEncountered,
    toolUsed,
  };
}

export async function callNutritionAgent(
  query: string,
  thread_id: string,
  patientId: string
) {
  // Define a new type that extends the existing state type
  type NutritionAgentState = {
    messages: (AIMessage | HumanMessage)[];
  };
  let errorEncountered = false;
  // Retrieve existing state if it exists; otherwise, start a new one
  let initialState: NutritionAgentState =
    nutritionConversationCache.get(thread_id);
  if (!initialState) {
    console.log(
      `🛑 No existing state for thread_id: ${thread_id}, initializing new conversation.`
    );
    initialState = {
      messages: [new HumanMessage(query)],
    };
  } else {
    // Append the new user message to the existing messages
    initialState.messages.push(new HumanMessage(query));
  }

  //Define tools
  const logMealTool = new LogMealTool(patientId);
  const tools = [
    new MealPlanGeneratorTool(patientId),
    new RecipeGeneratorTool(patientId),
    new GroceryListGeneratorTool(patientId),
    new NutritionFeedbackTool(patientId),
    new InstacartShoppingListTool(patientId),
    new FallbackTool(patientId),
    logMealTool,
    new SubAccountMealLoggingTool(patientId, logMealTool),
  ];
  const toolNode = new ToolNode<typeof GraphState.State>(tools);

  // Define the chat model (using ChatOpenAI) and bind the tools
  const model = new ChatOpenAI({
    openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
    model: "gpt-4o-mini",
    temperature: 0.1,
  }).bindTools(tools);

  // Define the chat prompt template correctly
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a helpful AI nutrition assistant. Use tools to generate personalized recommendations.
      If a request involves meal planning, grocery lists, recipes, or nutrition feedback, **always call the corresponding tool** instead of generating a direct response.
      If a request involves portion sizing or how much of a specific food a user should eat, **inform the user that there is a portion calculator tool that they can use in the previous screen, answer like I would like to help you but you can use the tool...that is more reliable**.

      **Meal Logging Logic:**
      - If the user wants to **log meals, food entries, or favorite meals**, use the appropriate tool:
        - **Sub-Account Meal Logging Tool**: Use when the user mentions someone else's name in a meal logging context. This tool uses AI to intelligently detect sub-account references (e.g., "Tommy had breakfast", "log meal for Sarah", "my son ate...", "Thomas had eggs and sausages", these are examples do not always use these names in the query unless the user mentions them)
        - **Log Meal Tool**: Use for the main user's own meal logging (e.g., "I ate breakfast", "log my meal", "I had my favorite breakfast", "log my favorite lunch")
      
      **Favorite Meal Detection:**
      - When user mentions **"my favorite breakfast/lunch/dinner"**, **"favorite meal"**, **"my usual meal"**, **"go-to meal"**, or **"saved meal"** - IMMEDIATELY use Log Meal Tool
      - Examples: "log my favorite breakfast", "I had my favorite lunch", "can you log my usual dinner", "my go-to breakfast"
      - **MULTIPLE FAVORITES**: When user mentions multiple favorite meals in one request, treat as pure favorite query
      - Examples: "log my favorite breakfast and my favorite lunch", "I had my favorite breakfast and my usual dinner", "can you log me my favorite breakfast and my favorite lunch with rice, peas, and carrots"
      - For PURE favorite meal requests (only favorites mentioned): prefix with "FAVORITE_MEAL: " in the string input
      - For MIXED requests (favorites + regular meals): prefix with "MIXED_MEAL: " in the string input
      - The Log Meal Tool will automatically detect and use the saved favorite meal data
      - DO NOT ask for details - just log the favorite meal directly
      
      **IMPORTANT: Meal Batching for Efficiency:**
      - When logging multiple meals for the same day, ALWAYS batch them together in a single tool call
      - Example: If user says "Monday I had breakfast: eggs and bacon, lunch: chicken salad, dinner: salmon with potatoes" - call LogMealTool ONCE with the entire description
      - DO NOT make separate tool calls for each meal - this wastes tokens and is inefficient
      - The LogMealTool is designed to handle multiple meals in a single call

      You have the following tools available:
      - **Meal Plan Generator**: Creates personalized meal plans.
      - **Recipe Generator**: Provides step-by-step recipes.
      - **Grocery List Generator**: Generates grocery lists based on diet needs.
      - **Sub-Account Meal Logging Tool**: Uses AI to intelligently detect sub-account references and logs meals for them (use when names are mentioned).
      - **Log Meal Tool**: Logs meals for the main user, including favorite meals (automatically detects and uses saved favorite meal data).
      - **Nutrition Feedback Tool**: Analyzes user nutrition and provides personalized feedback.
      - **Instacart Shopping List Generator**: Generates a shoppable Instacart link from a generated grocery list.
      - **Fallback Tool**: Handles general queries when no specialized tool applies.

      Always use the correct tool when responding.
      - If you generate a meal plan, ask the user if they want to save it.
      - If you generate a grocery list or a recipe, ask the user if they want to generate an Instacart shoppable link.
      - For meal logging, use Sub-Account Meal Logging Tool when names are mentioned, otherwise use Log Meal Tool.

      - If a tool has been used, end your response with **[toolUsed:name_of_the_tool]** (do not include the word "append") no matter if the output is in json.
    - If NO tool has been used, **you MUST end your response with** [toolUsed:none] (do not include the word "append"). **This is REQUIRED in every response no matter if the output is in json.**
    
    **CRITICAL: Log Meal Tool Parameter Format:**
    - For favorite meals: Pass as OBJECT {foodDescription: "user query", containsFav: true, isMixedQuery: false}
    - For mixed queries: Pass as OBJECT {foodDescription: "user query", containsFav: true, isMixedQuery: true}
    - For regular meals: Pass as STRING "user query"
    - NEVER pass favorite meal requests as strings - always use object format with parameters

    -  Extract key  parameters from the user request and generate a concise YouTube search query:

    **User Request:** ${query}
      `,
    ],
    new MessagesPlaceholder("messages"),
  ]);

  // Main function for processing the conversation and generating a response

  async function callModel(state: NutritionAgentState) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (!lastMessage) {
      // console.error("⚠️ No last message found in state!");
      return { messages: [new AIMessage("⚠️ Something went wrong.")] };
    }

    // console.log("🛠️ Checking tool calls in last message...");
    if (lastMessage.tool_calls && lastMessage.tool_calls.length === 0) {
      console.warn("⚠️ No tool calls detected. The model might fail.");
    }

    // Properly format the prompt
    const formattedPrompt = await prompt.invoke({
      system_message: "You are a helpful AI Primary Care Assistant",
      time: new Date().toISOString(),
      tool_names: tools.map((tool) => tool.name).join(", "),
      messages: state.messages,
    });

    // console.log("📨 Sending prompt to AI:", formattedPrompt);

    // **Retry Mechanism: Up to 3 attempts**
    const maxRetries = 3;
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        // console.log(`🔄 Attempt ${attempt + 1} to invoke AI model...`);
        const result = await model.invoke(formattedPrompt);
        // console.log("🤖 AI Model Response:", JSON.stringify(result, null, 2));

        if (result.tool_calls && result.tool_calls.length === 0) {
          console.warn("⚠️ Model did not invoke any tools. Possible issue.");
        }

        return { messages: [result] };
      } catch (error) {
        console.error(`❌ Error on attempt ${attempt + 1}:`, error);
        attempt++;
        if (attempt === maxRetries) {
          console.error(
            "🚨 Maximum retry attempts reached. Returning error response."
          );
          errorEncountered = true;
          console.log("error encoured ");
          return {
            messages: [new AIMessage("I'm sorry, something went wrong.")],
          };
        }
      }
    }
  }

  // Function to determine whether the conversation should continue
  function shouldContinue(state: NutritionAgentState) {
    console.log("🔍 Checking shouldContinue condition...");

    if (!state.messages || state.messages.length === 0) {
      console.warn("⚠️ No messages in state, defaulting to fallback.");
      return "fallback";
    }

    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    console.log("🛠️ Last message analysis:", lastMessage);

    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      console.log("✅ Tool calls detected. Proceeding to tools execution.");
      return "tools";
    }

    if (
      typeof lastMessage.content === "string" &&
      lastMessage.content.includes("FallbackTool activated")
    ) {
      return "__end__";
    }

    console.warn("⚠️ AI returned an empty response, triggering fallback.");
    return "fallback";
  }

  // Set up the workflow using the StateGraph with agent and tools
  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    // .addNode("fallback", fallbackTool)
    .addNode("fallback", new FallbackTool(patientId))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent")
    .addEdge("fallback", "__end__");

  // Compile the workflow
  const app = workflow.compile();

  // Execute the workflow with the provided conversation state and query
  const finalState = await app.invoke(initialState, {
    recursionLimit: 15,
    configurable: { thread_id },
  });

  // Validate and update the conversation cache
  if (!finalState.messages || finalState.messages.length === 0) {
    console.warn(
      `⚠️ AI returned an empty state, resetting cache for thread_id: ${thread_id}`
    );
    nutritionConversationCache.delete(thread_id);
  } else if (
    finalState.messages.some((msg) => {
      if (msg.getType() === "tool" && "tool_calls" in msg) {
        const toolCalls = msg.tool_calls as unknown;

        return Array.isArray(toolCalls) && toolCalls.length === 0;
      }
      return false;
    })
  ) {
    console.error(
      `🚨 Detected a tool message without tool calls. Resetting cache.`
    );
    nutritionConversationCache.delete(thread_id);
  } else {
    nutritionConversationCache.set(thread_id, finalState);
  }
  // Flagging the tool used
  const aiMessages = finalState.messages.filter(
    (msg) => msg instanceof AIMessage
  );
  const lastAIMessage = aiMessages[aiMessages.length - 1] as AIMessage;
  const lastMessageContent =
    typeof lastAIMessage.content === "string" ? lastAIMessage.content : "";
  const toolUsagePattern = /\[toolUsed:([^\]]+)\]/;
  const toolMatch = lastMessageContent.match(toolUsagePattern);
  const toolUsed = toolMatch !== null ? toolMatch[1] : "none";
  // Get the result (AI's final response to the user)
  const result =
    lastMessageContent.replace(toolMatch[0], "").trim() ??
    "⚠️ No response from AI";

  console.log("🤖 Final AI Response:", result);

  return {
    threadId: thread_id,
    result,
    errorEncountered: errorEncountered,
    toolUsed: toolUsed,
  };
}

export async function callFitnessAgent(
  query: string,
  thread_id: string,
  patientId: string
) {
  type FitnessAgentState = {
    messages: (AIMessage | HumanMessage)[];
  };
  let errorEncountered = false;
  // Retrieve existing state if it exists; otherwise, start a new one
  let initialState = fitnessConversationCache.get(thread_id);
  if (!initialState) {
    console.log(
      `🛑 No existing state for thread_id: ${thread_id}, initializing new conversation.`
    );
    initialState = { messages: [new HumanMessage(query)] };
  } else {
    // Append the new user message to the existing messages
    initialState.messages.push(new HumanMessage(query));
  }

  //Define tools
  const tools = [
    new WorkoutPlanGeneratorTool(patientId),
    new FitnessFallbackTool(patientId),
  ];
  const toolNode = new ToolNode<typeof GraphState.State>(tools);

  // Define the chat model (using ChatOpenAI) and bind the tools
  const model = new ChatOpenAI({
    openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
    model: "gpt-4o-mini",
    temperature: 0.1,
  }).bindTools(tools);

  // Define the chat prompt template correctly
  const workoutKeywords = [
    "workout plan",
    "exercise routine",
    "training program",
    "fitness",
  ];
  const isWorkoutRequest = workoutKeywords.some((keyword) =>
    query.toLowerCase().includes(keyword)
  );
  const optimizedQuery = `
  Extract key workout parameters from this user request and generate a concise YouTube search query:

  **User Request:** ${query}

  **Example Output Format:** "Quick 15 min Beginner Flexibility & Mobility Workout"

  **Guidelines:**
  - If "Quick Workout (Under 15 min)" is mentioned → use "Quick 15 min Workout".
  - Extract fitness goal (e.g., "Flexibility & Mobility").
  - Extract specialization (e.g., "Beginner-Friendly").
  - Keep the query short and to the point.
`;
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      `You are a helpful AI Fitness assistant. Collaborate with other tools to generate personalized recommendations based on the user's data.
    - If needed, **execute available tools** to enhance the response.
    ${isWorkoutRequest && optimizedQuery}
    - If a tool has been used, end your response with **[toolUsed:name_of_the_tool]** (do not include the word "append").
    - If NO tool has been used, **you MUST end your response with** [toolUsed:none] (do not include the word "append"). **This is REQUIRED in every response.**
    
    **Example Responses:**
    - **If a tool is used:** "Based on your goals, you should increase protein intake. [toolUsed:RetrieveNutritionData]"
    - **If no tool is used:** "Hello! How can I assist you? [toolUsed:none]"

    - ***DO NOT OMIT THIS FORMAT UNDER ANY CIRCUMSTANCES.***
    `,
    ],
    new MessagesPlaceholder("messages"),
  ]);

  // Main function for processing the conversation and generating a response

  async function callModel(state: FitnessAgentState) {
    // console.log(
    //   "🚀 Calling AI Model with state:",
    //   JSON.stringify(state, null, 2)
    // );

    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (!lastMessage) {
      // console.error("⚠️ No last message found in state!");
      return { messages: [new AIMessage("⚠️ Something went wrong.")] };
    }

    // console.log("🛠️ Checking tool calls in last message...");
    if (lastMessage.tool_calls && lastMessage.tool_calls.length === 0) {
      console.warn("⚠️ No tool calls detected. The model might fail.");
    }

    // Properly format the prompt
    const formattedPrompt = await prompt.invoke({
      system_message: "You are a helpful AI Fitness Assistant",
      time: new Date().toISOString(),
      tool_names: tools.map((tool) => tool.name).join(", "),
      messages: state.messages,
    });

    // console.log("📨 Sending prompt to AI:", formattedPrompt);

    // **Retry Mechanism: Up to 3 attempts**
    const maxRetries = 3;
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        // console.log(`🔄 Attempt ${attempt + 1} to invoke AI model...`);
        const result = await model.invoke(formattedPrompt);
        // console.log("🤖 AI Model Response:", JSON.stringify(result, null, 2));

        if (result.tool_calls && result.tool_calls.length === 0) {
          console.warn("⚠️ Model did not invoke any tools. Possible issue.");
        }

        return { messages: [result] };
      } catch (error) {
        console.error(`❌ Error on attempt ${attempt + 1}:`, error);
        attempt++;
        if (attempt === maxRetries) {
          console.error(
            "🚨 Maximum retry attempts reached. Returning error response."
          );
          errorEncountered = true;
          return {
            messages: [new AIMessage("I'm sorry, something went wrong.")],
          };
        }
      }
    }
  }

  // Function to determine whether the conversation should continue
  function shouldContinue(state: FitnessAgentState) {
    console.log("🔍 Checking shouldContinue condition...");

    if (!state.messages || state.messages.length === 0) {
      console.warn("⚠️ No messages in state, defaulting to fallback.");
      return "fallback";
    }

    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    // console.log("🛠️ Last message analysis:", lastMessage);

    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      console.log("✅ Tool calls detected. Proceeding to tools execution.");
      return "tools";
    }

    if (lastMessage.content?.length > 0) {
      console.log("✅ AI responded with content. Ending conversation.");
      return "__end__";
    }

    console.warn("⚠️ AI returned an empty response, triggering fallback.");
    return "fallback";
  }

  // Set up the workflow using the StateGraph with agent and tools
  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("fallback", new FallbackTool(patientId))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent")
    .addEdge("fallback", "__end__");

  // Compile the workflow
  const app = workflow.compile();

  // Execute the workflow with the provided conversation state and query
  const finalState = await app.invoke(initialState, {
    recursionLimit: 15,
    configurable: { thread_id },
  });

  // Validate and update the conversation cache
  if (!finalState.messages || finalState.messages.length === 0) {
    console.warn(
      `⚠️ AI returned an empty state, resetting cache for thread_id: ${thread_id}`
    );
    fitnessConversationCache.delete(thread_id);
  } else if (
    finalState.messages.some((msg) => {
      if (msg.getType() === "tool" && "tool_calls" in msg) {
        const toolCalls = msg.tool_calls as unknown;
        return Array.isArray(toolCalls) && toolCalls.length === 0;
      }
      return false;
    })
  ) {
    console.error(
      `🚨 Detected a tool message without tool calls. Resetting cache.`
    );
    fitnessConversationCache.delete(thread_id);
  } else {
    fitnessConversationCache.set(thread_id, finalState);
  }
  // Flagging the tool used
  const aiMessages = finalState.messages.filter(
    (msg) => msg instanceof AIMessage
  );
  const lastAIMessage = aiMessages[aiMessages.length - 1] as AIMessage;
  const lastMessageContent =
    typeof lastAIMessage.content === "string" ? lastAIMessage.content : "";
  const toolUsagePattern = /\[toolUsed:([^\]]+)\]/;
  const toolMatch = lastMessageContent.match(toolUsagePattern);
  const toolUsed = toolMatch !== null ? toolMatch[1] : "none";

  // Get the result (AI's final response to the user)
  const result =
    lastMessageContent.replace(toolMatch[0], "").trim() ??
    "⚠️ No response from AI";

  console.log("🤖 Final AI Response:", result);

  return {
    threadId: thread_id,
    result,
    errorEncountered: errorEncountered,
    toolUsed: toolUsed,
  };
}

export async function callHealthAgent(
  query: string,
  thread_id: string,
  patientId: string
) {
  type HealthAgentState = {
    messages: (AIMessage | HumanMessage)[];
    isSymptomsMode?: boolean;
  };

  let errorEncountered = false;

  let initialState = healthConversationCache.get(thread_id);

  if (!initialState) {
    console.log(
      `🛑 No existing state for thread_id: ${thread_id}, initializing new conversation.`
    );
    initialState = {
      messages: [new HumanMessage(query)],
      isSymptomsMode: false,
    };
  } else {
    console.log(`🔄 Resuming conversation for thread_id: ${thread_id}`);
    initialState.messages.push(new HumanMessage(query));

    // Ensure isSymptomsMode exists
    if (initialState.isSymptomsMode === undefined) {
      initialState.isSymptomsMode = false;
    }
  }

  // **Step 1: Check if we're already in symptoms mode**
  let isSymptomsMode = initialState.isSymptomsMode ?? false;
  console.log("is symptoms checker", isSymptomsMode);
  // **Step 2: Classify only if we are not in symptoms mode**
  if (!isSymptomsMode) {
    isSymptomsMode = await classifyQuery(query);
    console.log(`🩺 Classification Result: isSymptomsMode = ${isSymptomsMode}`);
  }

  //Define tools
  const tools = [
    new RecommendedTestGeneratorTool(patientId),
    new HealthFallbackTool(patientId),
    new RetrievePatientData(patientId),
  ];
  const toolNode = new ToolNode<typeof GraphState.State>(tools);
  // Define the chat model (using ChatOpenAI) and bind the tools
  const model = new ChatOpenAI({
    openAIApiKey: process.env.REACT_APP_OPENAI_API_KEY,
    model: "gpt-4o-mini",
    temperature: 0.1,
  }).bindTools(tools);
  // **Step 3: Choose the correct prompt**
  const prompt = isSymptomsMode
    ? ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a structured AI medical assistant that specializes in **symptom analysis**.
        - Your goal is to **gather detailed information** about a patient's symptoms before suggesting any next steps.
        - **Continue asking follow-up questions** until you have gathered enough details about the symptoms.
        - **Ask only one follow-up question at a time** and wait for the user's response before proceeding.
        - **Before making a diagnosis, if additional data is needed, retrieve the patient's medical summary using the 'RetrievePatientData' tool.**
        - **Once the necessary data is retrieved, incorporate it into your reasoning and provide a response.**
        - **When providing a final diagnosis, end the response with: "[FINAL_RESPONSE]"**.
    
        **Rules:**
        - **DO NOT retrieve patient data unless it is required for the diagnosis.**
        - **If you need more details (e.g., vitals, medical history, allergies, medications, nutrition data, or lab results), CALL the 'RetrievePatientData' tool before answering.**
        - **Always ensure the final diagnosis starts with "Based on the symptoms you shared" and ends with "[FINAL_RESPONSE]".**
    
        **Example Conversation:**
        - **User:** "I feel tired all the time."
        - **AI:** "How long have you been feeling this way?"
        - **User:** "For about two weeks."
        - **(AI calls 'RetrievePatientData' tool)**
        - **AI:** "Your iron levels are slightly low. Have you had dietary changes recently?"
        - **User:** "I've been eating less red meat."
        - **AI:** "Based on the symptoms you shared, this could be related to mild iron deficiency. I recommend increasing iron-rich foods and consulting a doctor if symptoms persist. [FINAL_RESPONSE]"`,
        ],
        new MessagesPlaceholder("messages"),
      ])
    : ChatPromptTemplate.fromMessages([
        [
          "system",
          `You are a helpful AI medical assistant.
        - Answer general health-related questions.
        - If needed, use **external tools** to assist users.
        - Available tools:
          - **Recommended Test Generator**: Suggests medical tests based on symptoms.
          - **Health Fallback Tool**: Handles general health-related questions.
        - **When providing a final response, end the message with: "[FINAL_RESPONSE]"**.
        `,
        ],
        new MessagesPlaceholder("messages"),
      ]);

  // **Step 4: Store Symptoms Mode in Cache**
  initialState.isSymptomsMode = isSymptomsMode;
  // healthConversationCache.set(thread_id, {
  //   ...(initialState as HealthAgentState),
  //   isSymptomsMode,
  // });
  healthConversationCache.set(thread_id, {
    messages: [...initialState.messages], // Preserve all messages
    isSymptomsMode, // Explicitly store the symptoms mode
  });

  // console.log(
  //   `✅ Updated Cache for thread_id ${thread_id}:`,
  //   healthConversationCache.get(thread_id)
  // );

  // **Step 5: Process the AI Response**
  async function callModel(state: HealthAgentState) {
    // console.log(
    //   "🚀 Calling AI Model with state:",
    //   JSON.stringify(state, null, 2)
    // );

    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (!lastMessage) {
      // console.error("⚠️ No last message found in state!");
      return { messages: [new AIMessage("⚠️ Something went wrong.")] };
    }

    // console.log("🛠️ Checking tool calls in last message...");
    if (lastMessage.tool_calls && lastMessage.tool_calls.length === 0) {
      console.warn("⚠️ No tool calls detected. The model might fail.");
    }

    // Properly format the prompt
    const formattedPrompt = await prompt.invoke({
      system_message: "You are a helpful AI Primary Care Assistant",
      time: new Date().toISOString(),
      tool_names: tools.map((tool) => tool.name).join(", "),
      messages: state.messages,
    });

    // console.log("📨 Sending prompt to AI:", formattedPrompt);

    // **Retry Mechanism: Up to 3 attempts**
    const maxRetries = 3;
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        // console.log(`🔄 Attempt ${attempt + 1} to invoke AI model...`);
        const result = await model.invoke(formattedPrompt);
        // console.log("🤖 AI Model Response:", JSON.stringify(result, null, 2));

        if (result.tool_calls && result.tool_calls.length === 0) {
          console.warn("⚠️ Model did not invoke any tools. Possible issue.");
        }

        return { messages: [result] };
      } catch (error) {
        console.error(`❌ Error on attempt ${attempt + 1}:`, error);
        attempt++;
        if (attempt === maxRetries) {
          console.error(
            "🚨 Maximum retry attempts reached. Returning error response."
          );
          errorEncountered = true;
          return {
            messages: [new AIMessage("I'm sorry, something went wrong.")],
          };
        }
      }
    }
  }

  // **Step 6: Ensure Proper Continuation Logic**
  function shouldContinue(state: HealthAgentState) {
    console.log("🔍 Checking shouldContinue condition...");

    if (!state.messages || state.messages.length === 0) {
      console.warn("⚠️ No messages in state, defaulting to fallback.");
      return "fallback";
    }

    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      console.log("✅ Tool calls detected. Proceeding to tools execution.");
      return "tools";
    }

    if (lastMessage.content?.length > 0) {
      console.log("✅ AI responded with content. Ending conversation.");
      return "__end__";
    }

    console.warn("⚠️ AI returned an empty response, triggering fallback.");
    return "fallback";
  }

  // **Step 7: Workflow Execution**
  const workflow = new StateGraph(GraphState)
    .addNode("agent", callModel)
    .addNode("tools", toolNode)
    .addNode("fallback", new HealthFallbackTool(patientId))
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent")
    .addEdge("fallback", "__end__");

  const app = workflow.compile();
  // Preserve isSymptomsMode before overwriting the cache
  const preservedSymptomsMode = initialState.isSymptomsMode;

  // Invoke the workflow
  const finalState = await app.invoke(initialState, {
    recursionLimit: 15,
    configurable: { thread_id },
  });

  const aiMessages = finalState.messages.filter(
    (msg) => msg instanceof AIMessage
  );

  const lastAIMessage = aiMessages[aiMessages.length - 1] as AIMessage;
  const lastMessageContent =
    typeof lastAIMessage.content === "string" ? lastAIMessage.content : "";

  if (lastMessageContent.includes("[FINAL_RESPONSE]")) {
    healthConversationCache.set(thread_id, {
      ...finalState,
      isSymptomsMode: false,
    });
  } else {
    // Store updated symptoms mode status after AI processing
    healthConversationCache.set(thread_id, {
      ...finalState,
      isSymptomsMode: preservedSymptomsMode,
    });
  }

  return {
    threadId: thread_id,
    result:
      lastMessageContent.replace("[FINAL_RESPONSE]", "").trim() ??
      "⚠️ No response from AI",
    // result:
    //   finalState.messages[finalState.messages.length - 1]?.content ??
    //   "⚠️ No response from AI",
    errorEncountered,
  };
}
