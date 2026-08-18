import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import input from "input";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { retrieveTriStreamContext } from "./services/triStreamRetriever.js";
import { prepareDispatchPayload } from "./services/promptAssembler.js";
import { processOutput } from "./services/postProcessor.js";
import { updateContactMemory, recordIncomingTurn, recordOutgoingTurn, getRecentTurns } from "./services/contactMemoryService.js";
import { logChatTurn } from "./services/continuousLogger.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Load Configuration ---
const CONFIG_DIR = path.join(__dirname, "config");
const FILTER_FILE = path.join(CONFIG_DIR, "filter_config.json");

let filterConfig = {
  mode: "ALLOWLIST_ONLY",
  allowed_users: [],
  blocked_users: [],
  keyword_triggers: [],
  high_stakes_keywords: [],
  high_stakes_patterns: []
};

function loadFilterConfig() {
  if (fs.existsSync(FILTER_FILE)) {
    try {
      filterConfig = JSON.parse(fs.readFileSync(FILTER_FILE, "utf-8"));
    } catch {
      console.warn("[Config] Could not parse filter_config.json, defaulting to ALLOWLIST_ONLY.");
    }
  }
}
loadFilterConfig();

function mergeContextTurns(cloudTurns = [], localTurns = [], limit = 8) {
  const map = new Map();
  const combined = [...cloudTurns, ...localTurns];

  for (const t of combined) {
    if (!t || !t.content || !t.content.trim()) continue;
    const cleanContent = t.content.trim();
    const key = `${t.role}:${cleanContent.toLowerCase().substring(0, 60)}`;
    if (!map.has(key)) {
      map.set(key, {
        role: t.role === "assistant" ? "assistant" : "user",
        content: cleanContent,
        timestamp: t.timestamp || Date.now()
      });
    }
  }

  const merged = Array.from(map.values());
  merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return merged.slice(-limit);
}

/**
 * Phase 1: Intent & High-Stakes Guardrail Check
 * Check allowlist/blocklist and sensitive trigger keywords/regexes.
 */
function checkGuardrailAndFiltering(chatId, senderId, senderUsername, messageText) {
  loadFilterConfig();

  const mode = filterConfig.mode || "ALLOWLIST_ONLY";
  const allowed = (filterConfig.allowed_users || []).map((u) => String(u).toLowerCase());
  const blocked = (filterConfig.blocked_users || []).map((u) => String(u).toLowerCase());
  const keywords = (filterConfig.keyword_triggers || []).map((k) => String(k).toLowerCase());

  const cleanSenderId = String(senderId || "").toLowerCase();
  const cleanChatId = String(chatId || "").toLowerCase();
  const cleanUsername = String(senderUsername || "").replace(/^@/, "").toLowerCase();
  const cleanMsg = String(messageText || "").toLowerCase();

  // 1. Blocklist Check (0ms Instant Drop)
  if (
    blocked.includes(cleanSenderId) ||
    blocked.includes(cleanChatId) ||
    (cleanUsername && blocked.includes(cleanUsername))
  ) {
    console.log(` 🛑 SENDER BLOCKED (@${cleanUsername || cleanSenderId}). Skipping auto-reply.`);
    return { shouldReply: false, isHighStakes: false };
  }

  // 2. Allowlist Check
  if (mode === "ALLOWLIST_ONLY") {
    const isAllowed =
      allowed.includes("all") ||
      allowed.includes("*") ||
      allowed.includes(cleanSenderId) ||
      allowed.includes(cleanChatId) ||
      (cleanUsername && allowed.includes(cleanUsername));

    if (!isAllowed) {
      console.log(` ⛔ SENDER NOT IN ALLOWLIST (@${cleanUsername || cleanSenderId}). Skipping auto-reply.`);
      return { shouldReply: false, isHighStakes: false };
    }
  }

  // 3. Keyword Trigger Check (Optional Mode)
  if (mode === "KEYWORD_ONLY" && keywords.length > 0) {
    const hasKeyword = keywords.some((kw) => cleanMsg.includes(kw));
    if (!hasKeyword) {
      console.log(` 🔑 NO TRIGGER KEYWORD FOUND in message from @${cleanUsername || cleanSenderId}. Skipping auto-reply.`);
      return { shouldReply: false, isHighStakes: false };
    }
  }

  // 4. High-Stakes Guardrail Check (Sensitive/Credentials/Financial)
  const highStakesKeywords = filterConfig.high_stakes_keywords || [
    "send money", "cbe", "telebirr", "bank account", "transfer money",
    "password", "ssh key", "private key", "access token", "api key", "credentials"
  ];
  const highStakesPatterns = filterConfig.high_stakes_patterns || [
    "(send|transfer)\\s+money", "cbe(\\s+birr)?", "telebirr", "pass(word)?", "private_key", "ssh-rsa"
  ];

  const matchedKeyword = highStakesKeywords.find((kw) => cleanMsg.includes(kw.toLowerCase()));
  let matchedPattern = false;

  if (!matchedKeyword) {
    for (const pat of highStakesPatterns) {
      try {
        const regex = new RegExp(pat, "i");
        if (regex.test(cleanMsg)) {
          matchedPattern = true;
          break;
        }
      } catch (e) {
        // Ignore invalid regex in config
      }
    }
  }

  if (matchedKeyword || matchedPattern) {
    console.warn(` ⚠️ [HIGH-STAKES GUARDRAIL TRIGGERED] Message from @${cleanUsername || cleanSenderId} contains sensitive/financial request ("${messageText}"). Auto-reply muted.`);
    return { shouldReply: false, isHighStakes: true };
  }

  return { shouldReply: true, isHighStakes: false };
}

// --- Environment Variables ---
const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const sessionString = process.env.TG_SESSION || "";

const llmApiUrl = process.env.LLM_API_URL || "https://ai.addisentrancehub.com/v1/chat/completions";
const llmApiKey = process.env.LLM_API_KEY || "";
const llmModel = process.env.LLM_MODEL || "openai/gpt-oss-20b";
const llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 35000;
const cooldownSeconds = Number(process.env.COOLDOWN_SECONDS) || 10;
const historyLimit = Number(process.env.HISTORY_LIMIT) || 25;

if (!apiId || !apiHash) {
  console.error(" Error: TG_API_ID and TG_API_HASH must be set in your .env file.");
  process.exit(1);
}

if (!llmApiKey) {
  console.warn(" Warning: LLM_API_KEY is not set in .env. AI calls will fail until set.");
}

const stringSession = new StringSession(sessionString);
const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 15,
  autoReconnect: true,
  timeout: 15000,
});

// --- In-Memory Rate Limiter Map & Sequential Message Queue ---
const lastRepliedPerChat = new Map();
let messageQueue = Promise.resolve();

/**
 * Fetch recent chat history directly from Telegram Cloud
 */
async function fetchTelegramHistory(inputEntity, limit = 20) {
  try {
    let target = inputEntity;
    try {
      target = await client.getEntity(inputEntity);
    } catch {
      // Fall back to raw inputEntity
    }

    const rawMessages = await client.getMessages(target, { limit });
    if (!rawMessages || rawMessages.length === 0) {
      return [];
    }

    const formattedHistory = [];
    const validMessages = [...rawMessages].reverse().filter((m) => m && m.text);

    for (const msg of validMessages) {
      formattedHistory.push({
        role: msg.out ? "assistant" : "user",
        content: msg.text,
      });
    }

    return formattedHistory;
  } catch (err) {
    console.error(" ❌ Could not fetch Telegram cloud history:", err.message);
    return [];
  }
}

/**
 * Send 'typing...' status indicator on Telegram chat
 */
async function sendTypingStatus(inputEntity) {
  try {
    await client.invoke(
      new Api.messages.SetTyping({
        peer: inputEntity,
        action: new Api.SendMessageTypingAction(),
      })
    );
  } catch (err) {
    // Ignore typing status invocation errors
  }
}

/**
 * Gateway Dispatch (Phase 4): Invoke LLM API endpoint with temperature=0.35 & max_tokens=120
 */
async function dispatchToGateway(dispatchPayload, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), llmTimeoutMs);

      const response = await fetch(llmApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${llmApiKey}`,
        },
        body: JSON.stringify({
          model: llmModel,
          messages: dispatchPayload.messages,
          temperature: dispatchPayload.temperature || 0.35,
          max_tokens: dispatchPayload.max_tokens || 120,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LLM API returned status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      const rawReply =
        choice?.message?.content ||
        choice?.message?.reasoning_content ||
        choice?.text ||
        "";

      if (!rawReply) {
        throw new Error("No content received from LLM API response.");
      }

      return rawReply.trim();
    } catch (error) {
      console.warn(` ⚠️ LLM Gateway Dispatch Attempt ${attempt}/${retries} failed (${error.message}). Retrying...`);
      if (attempt === retries) {
        console.error(" ❌ All LLM Gateway Dispatch retry attempts failed.");
        return null;
      }
      const backoffDelay = 2000 * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

const botMode = process.env.BOT_MODE || "active";

/**
 * Handle incoming Telegram DM event through full 6-phase pipeline
 */
async function handleIncomingMessage(event) {
  const message = event.message;

  if (!message || !message.text || message.out || !event.isPrivate) {
    return;
  }

  const chatId = message.chatId?.toString();
  const senderId = message.senderId?.toString();
  const senderUsername = message.sender?.username || event.sender?.username || "";
  const messageText = message.text;

  let inputEntity;
  try {
    inputEntity = await event.getInputChat();
  } catch {
    inputEntity = message.peerId || message.senderId || chatId;
  }

  // --- Phase 1: Intent & High-Stakes Guardrail Check ---
  const filterResult = checkGuardrailAndFiltering(chatId, senderId, senderUsername, messageText);

  if (filterResult.isHighStakes) {
    // Fail-soft policy: Mark as read, skip auto-reply, emit warning
    try {
      await client.markAsRead(inputEntity);
    } catch (e) {}
    console.log(` 🛡️ [PHASE 1 GUARDRAIL] Marked message as READ and muted auto-responder for sender @${senderUsername || senderId}.`);
    return;
  }

  if (!filterResult.shouldReply) {
    return;
  }

  console.log(`[INCOMING DM] Chat ID: ${chatId} | Sender ID: ${senderId} | Username: @${senderUsername}`);
  console.log(` Incoming: "${messageText}"`);

  // Send Telegram Read Receipt (Displays double checkmark ✔️✔️ to sender)
  try {
    await client.markAsRead(inputEntity);
  } catch {
    try {
      await client.invoke(new Api.messages.ReadHistory({ peer: inputEntity, maxId: 0 }));
    } catch {}
  }

  // OBSERVE MODE CHECK
  if (botMode === "observe") {
    console.log(` 👁️ [OBSERVE MODE ACTIVE] Logged incoming DM from @${senderUsername || senderId}. No auto-reply dispatched.`);
    return;
  }

  // Rate Limit Check
  const now = Date.now();
  const lastReplied = lastRepliedPerChat.get(chatId) || 0;
  const elapsedSeconds = (now - lastReplied) / 1000;

  if (elapsedSeconds < cooldownSeconds) {
    console.log(` ⏳ Rate limit active for Chat ID ${chatId} (${Math.ceil(cooldownSeconds - elapsedSeconds)}s remaining). Skipping.`);
    return;
  }

  lastRepliedPerChat.set(chatId, now);

  // Record incoming turn in memory buffer & persistent continuous logger
  recordIncomingTurn(senderId, messageText);
  logChatTurn("INCOMING", chatId, senderId, senderUsername, messageText);

  // --- Phase 2: Tri-Stream Retrieval Engine ---
  console.log(` 🔍 Running Tri-Stream Retrieval Engine (Stream A, Stream B, Stream C)...`);
  const triStreamData = await retrieveTriStreamContext(senderId, senderUsername, messageText);

  // Fetch and merge Telegram Cloud history + local RAM session turns into unified chronological context
  const fetchCloudHistory = process.env.FETCH_TELEGRAM_HISTORY !== "false";
  const targetPeer = message.peerId || message.senderId || inputEntity;
  const cloudTurns = fetchCloudHistory ? await fetchTelegramHistory(targetPeer, historyLimit) : [];
  const localTurns = getRecentTurns(senderId, historyLimit);

  const historyTurns = mergeContextTurns(cloudTurns, localTurns, historyLimit);

  console.log(` 📜 [CONVERSATION HISTORY RECALLED] (${historyTurns.length} turns in context):`);
  if (historyTurns.length === 0) {
    console.log(`    (No prior conversation history - starting fresh turn)`);
  } else {
    historyTurns.forEach((turn, idx) => {
      const roleLabel = turn.role === "assistant" ? "🤖 [BOT]" : "👤 [USER]";
      console.log(`    ${idx + 1}. ${roleLabel}: "${turn.content}"`);
    });
  }

  // --- Phase 3: System Prompt Synthesis & Dynamic Context Assembly ---
  const dispatchPayload = prepareDispatchPayload(triStreamData, historyTurns, messageText);

  // --- Phase 4: Gateway Dispatch ---
  console.log(` 🚀 Dispatching to Gateway (temp: ${dispatchPayload.temperature || 0.35}, max_tokens: ${dispatchPayload.max_tokens || 120})...`);
  const rawLlmOutput = await dispatchToGateway(dispatchPayload);

  if (!rawLlmOutput) {
    console.log(" Skipping auto-reply due to Gateway dispatch error.");
    return;
  }

  // --- Phase 5: Normalization & Post-Processing Pipeline ---
  console.log(` 🧹 Running Post-Processing Pipeline & Multi-Bubble Parser...`);
  const bubbles = processOutput(rawLlmOutput, triStreamData.streamA.recentMemories);

  if (!bubbles || bubbles.length === 0) {
    console.log(" No valid message bubbles remaining after post-processing.");
    return;
  }

  // --- Phase 6: Human Simulation & MTProto Delivery ---
  const typingSpeedMs = Number(process.env.TYPING_SPEED_MS) || 45;
  const minTypingDelay = Number(process.env.MIN_TYPING_DELAY_MS) || 800;
  const maxTypingDelay = Number(process.env.MAX_TYPING_DELAY_MS) || 2500;

  console.log(` 💬 Executing Multi-Bubble Delivery (${bubbles.length} bubble(s))...`);
  for (let i = 0; i < bubbles.length; i++) {
    const bubble = bubbles[i];

    // Per-bubble typing state + length-proportional delay
    const typingDelay = Math.min(Math.max(bubble.length * typingSpeedMs, minTypingDelay), maxTypingDelay);
    console.log(`   Bubble ${i + 1}/${bubbles.length}: "${bubble}" (${typingDelay}ms typing delay)`);

    await sendTypingStatus(inputEntity);
    await new Promise((resolve) => setTimeout(resolve, typingDelay));

    try {
      await client.sendMessage(inputEntity, {
        message: bubble,
        parseMode: "html"
      });
      // Update contact memory & record outgoing turn in persistent continuous logger
      updateContactMemory(senderId, messageText, bubble);
      logChatTurn("OUTGOING", chatId, senderId, senderUsername, bubble);
    } catch (sendErr) {
      // If HTML parse fails, fallback to plain text delivery
      try {
        await client.sendMessage(inputEntity, { message: bubble });
        updateContactMemory(senderId, messageText, bubble);
        logChatTurn("OUTGOING", chatId, senderId, senderUsername, bubble);
      } catch (fallbackErr) {
        console.error(` ❌ Failed to send bubble ${i + 1}:`, fallbackErr.message);
      }
    }
  }

  console.log(" ✅ All message bubbles delivered successfully!");
  console.log("-------------------------------------------------------");
}

async function main() {
  if (process.env.ENABLE_CACHE === "false") {
    console.log(" ℹ️ Global Cache is DISABLED (ENABLE_CACHE=false in .env). Running in zero-cache live mode.");
  }

  console.log(" Connecting to Telegram MTProto...");

  await client.start({
    phoneNumber: async () => await input.text("Please enter your phone number (+...): "),
    password: async () => await input.text("Please enter your 2FA password (if enabled): "),
    phoneCode: async () => await input.text("Please enter the code received on Telegram: "),
    onError: (err) => console.error("Login error:", err),
  });

  console.log("\n Successfully authenticated and connected to Telegram!");

  if (!sessionString) {
    const savedSession = client.session.save();
    console.log("\n=======================================================");
    console.log("FIRST TIME LOGIN SUCCESSFUL!");
    console.log("Copy the string below and set it as TG_SESSION in your .env:");
    console.log("-------------------------------------------------------");
    console.log(savedSession);
    console.log("=======================================================\n");
  } else {
    console.log(" Reused existing session from .env (TG_SESSION).");
  }

  console.log(` Listening for incoming DMs (Tri-Stream RAG + Multi-Bubble Pipeline Active)...\n`);

  client.addEventHandler((event) => {
    messageQueue = messageQueue
      .then(() => handleIncomingMessage(event))
      .catch((err) => console.error(" Error handling message in queue:", err));
  }, new NewMessage({}));

  process.on("SIGINT", async () => {
    console.log("\n Disconnecting client...");
    await client.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal initialization error:", err);
  process.exit(1);
});
