import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getContactMemory } from "./contactMemoryService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_DIR = path.resolve(__dirname, "../config");
const RELATIONSHIP_FILE = path.join(CONFIG_DIR, "relationship_tiers.json");
const FACTUAL_FILE = path.join(CONFIG_DIR, "factual_knowledge.json");

function loadJsonConfig(filePath, fallback = {}) {
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
      console.warn(`[TriStream] Failed to parse ${path.basename(filePath)}:`, e.message);
    }
  }
  return fallback;
}

export async function retrieveTriStreamContext(contactId, username, messageText) {
  const relConfig = loadJsonConfig(RELATIONSHIP_FILE, {
    default_tier: "close_friend",
    tiers: {
      close_friend: { name: "Close Friend", instructions: "Casual banter, direct and friendly tone." },
      colleague_tech: { name: "Tech Colleague", instructions: "Concise engineering shorthand, collaborative, direct problem solving." },
      client_business: { name: "Business Client", instructions: "Polite, concise, professional, clear boundaries, direct next steps." },
      student_general: { name: "Student / General", instructions: "Supportive, brief guidance, directs to public resources." }
    },
    contacts: {}
  });

  const factualConfig = loadJsonConfig(FACTUAL_FILE, {
    identity: { name: "Alex Dev", role: "Software Developer" },
    current_stack: ["Node.js", "TypeScript", "Python", "React"],
    active_projects: {
      "Project Alpha": "Fullstack web application"
    },
    current_status: "Coding and building projects"
  });

  const cleanId = String(contactId || "").toLowerCase();
  const cleanUsername = String(username || "").replace(/^@/, "").toLowerCase();

  const contactsMap = relConfig.contacts || {};
  let contactEntry = contactsMap[cleanId] || contactsMap[cleanUsername];

  const tierKey = contactEntry?.tier || relConfig.default_tier || "close_friend";
  const tierInfo = relConfig.tiers?.[tierKey] || relConfig.tiers?.close_friend || {};
  const contactName = contactEntry?.nickname || username || contactId || "User";

  const memory = getContactMemory(contactId);
  const recentMemories = Array.isArray(memory.recentReplies) ? memory.recentReplies : [];

  const streamA = {
    contactId,
    contactName,
    contactUsername: username || "",
    tier: tierKey,
    tierName: tierInfo.name || tierKey,
    tierInstructions: tierInfo.instructions || "Casual banter, direct and concise.",
    recentMemories,
    contactFacts: memory.contactFacts || [],
    lastTopic: memory.lastTopic || "",
    consecutiveRepeatCount: memory.consecutiveRepeatCount || 1
  };

  const streamB = {
    identity: factualConfig.identity || {},
    currentStack: factualConfig.current_stack || [],
    activeProjects: factualConfig.active_projects || {},
    currentStatus: factualConfig.current_status || ""
  };

  return {
    streamA,
    streamB
  };
}

export default {
  retrieveTriStreamContext
};
