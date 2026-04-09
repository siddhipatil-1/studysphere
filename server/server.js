require("dotenv").config();
const express = require("express");
const cors = require("cors");
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

// --- ROUTE 2: Handle AI Queries ---
app.post("/ask-ai", async (req, res) => {
  try {
    const { prompt, context } = req.body;

    console.log("Incoming request:", prompt);

    const fullPrompt = `
NOTES:
${context || "None"}

QUESTION:
${prompt}
`;

    res.json({ text: "Server working. Claude not connected yet." });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
