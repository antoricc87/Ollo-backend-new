import axios from "axios";

export const createShoppingList = async (
  lineItems: any[],
  retailer_key: string
) => {
  const url = "https://connect.instacart.com/idp/v1/products/products_link";

  const payload = {
    title: "Your Grocery List",
    image_url: "https://thumbs2.imgbox.com/89/c6/ErSndcBY_t.png",
    link_type: "shopping_list",
    expires_in: 24,
    instructions: [
      "This list includes healthy options based on your nutrition goals.",
    ],
    line_items: lineItems,
    // ingredients: lineItems,

    landing_page_configuration: {
      partner_linkback_url: "https://yourapp.com/shopping-list",
      enable_pantry_items: true,
    },
  };

  const headers = {
    Authorization: `Bearer ${process.env.INSTACART_API_KEY_PROD_RETAILERS}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, payload, { headers });
      console.log("✅ Shopping List Created:", response.data.products_link_url);
      const shoppingListWithRetailer =
        response.data.products_link_url + `?retailer_key=${retailer_key}`;
      return shoppingListWithRetailer;
    } catch (error) {
      console.error(`🚨 Attempt ${attempt} failed`);

      // Authentication error
      if (error.response?.status === 401) {
        console.error("🔑 Invalid API Key.");
        return "Authentication error: Please check your Instacart API key.";
      }

      // Invalid request
      if (error.response?.status === 400) {
        console.error("⚠️ Invalid request.");
        console.error(
          "Validation Errors:",
          JSON.stringify(error.response.data, null, 2)
        );
        return "Invalid request: Please check your grocery list items.";
      }

      // Rate limit exceeded
      if (error.response?.status === 429) {
        console.error("⏳ Too many requests.");
        return "You're making requests too quickly. Please wait and try again.";
      }

      // Server errors & automatic retry
      if (error.response?.status === 500) {
        console.warn(`Server error. Retrying... (${attempt}/${maxRetries})`);
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }

      // Network issues
      if (axios.isAxiosError(error) && !error.response) {
        console.error("🌐 Network error.");
        return "Network error: Unable to connect to Instacart.";
      }

      console.error("🛑 Unexpected error:", error.message);
      return "An unexpected error occurred. Please try again.";
    }
  }

  return "Failed to create the shopping list after multiple attempts.";
};
