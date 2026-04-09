require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
// const multer = require("multer");
// const fs = require("fs");
// const { GoogleGenerativeAI } = require("@google/generative-ai");
// const { GoogleAIFileManager } = require("@google/generative-ai/server");

const app = express();

// We use diskStorage now because Gemini File API requires a real file path to upload
// const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// Initialize Gemini and the File Manager
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// --- ROUTE 2: Handle AI Queries ---
app.post("/ask-ai", async (req, res) => {
  try {
    const { prompt, context } = req.body;

    console.log("AI Request:", prompt);

    const fullPrompt = `
You are a helpful, professional AI Study Assistant.

${context ? "STUDENT NOTES:\n" + context : ""}

USER QUESTION:
${prompt}

Give a clear, structured, easy-to-understand answer.
`;

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: fullPrompt,
        },
      ],
    });

    const text = response.content[0].text;

    res.json({ text });
  } catch (error) {
    console.error("Claude Error:", error);
    res.status(500).json({ error: "AI failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
