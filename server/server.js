require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

const app = express();

// We use diskStorage now because Gemini File API requires a real file path to upload
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

// Initialize Gemini and the File Manager
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

// --- ROUTE 1: Upload directly to Gemini API ---
app.post("/upload-file", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    // 1. Upload the physical file directly to Gemini
    const uploadResult = await fileManager.uploadFile(req.file.path, {
      mimeType: req.file.mimetype,
      displayName: req.file.originalname,
    });

    // 2. Delete the temporary file from our local server to save space
    fs.unlinkSync(req.file.path);

    // 3. Send the Gemini File URI back to the frontend
    res.json({
      fileUri: uploadResult.file.uri,
      mimeType: uploadResult.file.mimeType,
      fileName: req.file.originalname,
    });
  } catch (error) {
    console.error("Upload Error:", error);
    res.status(500).json({ error: "Failed to upload file to Gemini." });
  }
});

// --- ROUTE 2: Handle AI Queries ---
app.post("/ask-ai", async (req, res) => {
  try {
    // We now accept fileUri and fileMimeType from the frontend
    const { prompt, context, fileUri, fileMimeType } = req.body;
    console.log("AI Request received for action:", prompt);

    const model = genAI.getGenerativeModel(
      { model: "gemini-1.5-flash" },
      { apiVersion: "v1" }, // Force the stable v1 endpoint
    );

    let fullPrompt = `You are a helpful, professional AI Study Assistant.\n\n`;
    if (context && context.trim() !== "") {
      fullPrompt += `Use the following provided notes to help answer the user's request if relevant.\n\nNOTES CONTENT:\n${context}\n\n`;
    }
    fullPrompt += `USER REQUEST:\n${prompt}\n\nProvide a helpful, well-formatted response.`;

    // Create an array to hold our prompt data
    const promptData = [];

    // If the user uploaded a PDF to Gemini, add it to the prompt array
    if (fileUri && fileMimeType) {
      promptData.push({
        fileData: {
          mimeType: fileMimeType,
          fileUri: fileUri,
        },
      });
    }

    // Add the text instructions to the prompt array
    promptData.push({ text: fullPrompt });

    // Pass the combined array (File + Text) to Gemini
    const result = await model.generateContent(promptData);
    const response = await result.response;

    res.json({ text: response.text() });
  } catch (error) {
    console.error("AI Error:", error);
    res
      .status(500)
      .json({ error: "The AI is having trouble processing that." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // Create the 'uploads' folder if it doesn't exist yet
  if (!fs.existsSync("uploads")) {
    fs.mkdirSync("uploads");
  }
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
