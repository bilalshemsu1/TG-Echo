import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYSTEM_DATA_DIR = path.resolve(__dirname, "../system_data");
if (!fs.existsSync(SYSTEM_DATA_DIR)) {
  fs.mkdirSync(SYSTEM_DATA_DIR, { recursive: true });
}
const MEMORY_FILE = path.join(SYSTEM_DATA_DIR, "contact_memories.json");

let contactMemories = {};

function hashQuestion(question) {
  return (question || "")
    .toLowerCase()
    .replace(/\?\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

let isInitialLoaded = false;

function loadMemories() {
  if (isInitialLoaded) return;
  isInitialLoaded = true;

  if (process.env.ENABLE_CACHE === "false") {
    contactMemories = {};
    return;
  }
  if (fs.existsSync(MEMORY_FILE)) {
    try {
      contactMemories = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
    } catch {
      contactMemories = {};
    }
  }
}

function saveMemories() {
  if (process.env.ENABLE_CACHE === "false") return;
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(contactMemories, null, 2), "utf-8");
  } catch (err) {
    console.warn("[ContactMemoryService] Failed to save contact memories:", err.message);
  }
}

loadMemories();

export function getContactMemory(contactId) {
  loadMemories();
  const idStr = String(contactId || "default");
  return contactMemories[idStr] || {
    recentReplies: [],
    chatTurns: [],
    contactQuestions: [],
    contactFacts: [],
    lastTopic: "",
    updatedAt: Date.now()
  };
}

export function recordIncomingTurn(contactId, incomingText) {
  loadMemories();
  const idStr = String(contactId || "default");
  if (!contactMemories[idStr]) {
    contactMemories[idStr] = {
      recentReplies: [],
      chatTurns: [],
      contactQuestions: [],
      contactFacts: [],
      lastTopic: "",
      lastUserText: "",
      consecutiveRepeatCount: 1,
      updatedAt: Date.now()
    };
  }

  const memory = contactMemories[idStr];
  if (!Array.isArray(memory.chatTurns)) memory.chatTurns = [];

  if (incomingText && incomingText.trim()) {
    const normCurrent = hashQuestion(incomingText);
    const normLast = hashQuestion(memory.lastUserText || "");

    if (normCurrent === normLast && normCurrent.length > 0) {
      memory.consecutiveRepeatCount = (memory.consecutiveRepeatCount || 1) + 1;
    } else {
      memory.consecutiveRepeatCount = 1;
    }
    memory.lastUserText = incomingText.trim();

    memory.chatTurns.push({
      role: "user",
      content: incomingText.trim(),
      timestamp: Date.now()
    });
    if (memory.chatTurns.length > 50) {
      memory.chatTurns.shift();
    }
    memory.lastTopic = incomingText.trim().substring(0, 100);
    memory.updatedAt = Date.now();
    saveMemories();
  }
}

export function recordOutgoingTurn(contactId, replyText) {
  loadMemories();
  const idStr = String(contactId || "default");
  if (!contactMemories[idStr]) {
    contactMemories[idStr] = {
      recentReplies: [],
      chatTurns: [],
      contactQuestions: [],
      contactFacts: [],
      lastTopic: "",
      updatedAt: Date.now()
    };
  }

  const memory = contactMemories[idStr];
  if (!Array.isArray(memory.chatTurns)) memory.chatTurns = [];
  if (!Array.isArray(memory.recentReplies)) memory.recentReplies = [];

  if (replyText && replyText.trim()) {
    memory.chatTurns.push({
      role: "assistant",
      content: replyText.trim(),
      timestamp: Date.now()
    });
    if (memory.chatTurns.length > 50) {
      memory.chatTurns.shift();
    }

    memory.recentReplies.push(replyText.trim());
    if (memory.recentReplies.length > 6) {
      memory.recentReplies.shift();
    }
    memory.updatedAt = Date.now();
    saveMemories();
  }
}

export function getRecentTurns(contactId, limit = 10) {
  const memory = getContactMemory(contactId);
  const turns = Array.isArray(memory.chatTurns) ? memory.chatTurns : [];
  return turns.slice(-limit);
}

export function updateContactMemory(contactId, incomingText, replyText) {
  recordOutgoingTurn(contactId, replyText);
  return getContactMemory(contactId);
}

export default {
  getContactMemory,
  recordIncomingTurn,
  recordOutgoingTurn,
  getRecentTurns,
  updateContactMemory
};
