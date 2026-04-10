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

app.get("/", (req, res) => {
  res.send("Backend is running");
});

// --- ROUTE 2: Handle AI Queries ---
app.post("/ask-ai", async (req, res) => {
  try {
    const { prompt, context } = req.body;

    const fullPrompt = `
You are a helpful AI Study Assistant.

${context ? "STUDENT NOTES:\n" + context : ""}

QUESTION:
${prompt}

Answer in a SHORT and COMPLETE way:
- Use bullet points
- Include ALL key points
- Keep each point 1 line
- Do NOT give long explanations
- Ensure the full answer fits in a short response
`;

    const models = [
      "google/gemma-3-27b-it:free",
      "openai/gpt-oss-20b:free",
      "meta-llama/llama-3.2-3b-instruct:free",
    ];

    let data = null;

    for (const model of models) {
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://studysphere-1.vercel.app",
            "X-Title": "StudySphere",
          },
          body: JSON.stringify({
            model,
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

      data = await response.json();

      if (response.ok) {
        break;
      } else {
        console.log(`Model failed: ${model}`, data);
      }
    }

    if (!data || !data.choices) {
      return res
        .status(500)
        .json({ error: "All AI models are busy. Try again." });
    }

    const text =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.text ||
      "No response from AI";

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
