import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.resolve(__dirname, "../logs");
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const HUMAN_LOG_FILE = path.join(LOGS_DIR, "continuous_chat.log");
const JSONL_LOG_FILE = path.join(LOGS_DIR, "continuous_chat.jsonl");

export function logChatTurn(direction, chatId, senderId, senderUsername, content) {
  if (!content || !content.trim()) return;

  const timestamp = new Date().toISOString();
  const cleanUsername = senderUsername ? `@${senderUsername.replace(/^@/, "")}` : `User:${senderId}`;
  const cleanContent = content.trim();

  // Append to Human-Readable Log File (.log)
  const logLine = `[${timestamp}] [${direction.toUpperCase()}] Chat ID: ${chatId} | ${cleanUsername}: ${cleanContent}\n`;
  try {
    fs.appendFileSync(HUMAN_LOG_FILE, logLine, "utf-8");
  } catch (err) {
    console.warn("[ContinuousLogger] Failed to write to human log:", err.message);
  }

  // Append to Structured JSON Lines File (.jsonl)
  const jsonObject = {
    timestamp,
    direction: direction.toUpperCase(),
    chatId: String(chatId),
    senderId: String(senderId),
    username: cleanUsername,
    content: cleanContent
  };

  try {
    fs.appendFileSync(JSONL_LOG_FILE, JSON.stringify(jsonObject) + "\n", "utf-8");
  } catch (err) {
    console.warn("[ContinuousLogger] Failed to write to JSONL log:", err.message);
  }
}

export default {
  logChatTurn
};
