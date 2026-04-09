require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
// const multer = require("multer");
// const fs = require("fs");
// const { GoogleGenerativeAI } = require("@google/generative-ai");
// const { GoogleAIFileManager } = require("@google/generative-ai/server");

const app = express();

// We use diskStorage now because Gemini File API requires a real file path to upload
// const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

// Initialize Gemini and the File Manager
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

app.get("/models", async (req, res) => {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
    });

    const data = await response.json();

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch models" });
  }
});

// --- ROUTE 2: Handle AI Queries ---
app.post("/ask-ai", async (req, res) => {
  try {
    const { prompt, context } = req.body;

    const fullPrompt = `
You are a helpful, professional AI Study Assistant.

${context ? "STUDENT NOTES:\n" + context : ""}

USER QUESTION:
${prompt}

Give a clear, structured, easy-to-understand answer.
`;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mistralai/ministral-3b",
          max_tokens: 300,
          messages: [
            {
              role: "user",
              content: fullPrompt,
            },
          ],
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenRouter Error:", data);
      return res.status(500).json({ error: "AI failed" });
    }

    const text = data.choices?.[0]?.message?.content || "No response";

    res.json({ text });
  } catch (error) {
    console.error("Server Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
