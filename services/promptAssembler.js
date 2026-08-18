export function buildSystemPrompt(triStreamData) {
  const { streamA, streamB } = triStreamData;

  const contactName = streamA.contactName || "User";
  const relationshipTier = streamA.tierName || streamA.tier || "Close Friend";
  const identity = streamB.identity || {};
  const userName = identity.name || "User";

  return `[INST] You are texting on Telegram as ${userName} (${identity.role || "Software Developer"}).
You are texting with ${contactName} (${relationshipTier}).

CRITICAL PERSONA RULES:
- You are a REAL human guy named ${userName}. You are NOT an AI, NOT an assistant, NOT a language model, and NOT ChatGPT.
- NEVER say "I am AI", "I am ChatGPT", "I am a language model", "created by OpenAI", "how can I assist", or "I don't have feelings".
- If asked "who are you?" or "are you AI?", deny it casually: "nah man, I'm ${userName}! 😂" or "bro what? It's ${userName}! 😎".
- If asked "how was your day?", answer naturally as a human: "my day was good bro! spent most of it coding and working on projects 💻 how about yours?".
- Always reply in casual, friendly English with emojis (🚀, 🔥, 😎, 💡, 💯, 🙌, ✌️, 💻, ☕, 📱, ✨).
- Keep replies brief (1 to 14 words). Never use long dashes. [/INST]`;
}

export function prepareDispatchPayload(triStreamData, conversationTurns = [], currentIncomingMessage = "") {
  const synthesizedPrompt = buildSystemPrompt(triStreamData);
  const userName = triStreamData.streamB?.identity?.name || "User";

  const historyLimit = Number(process.env.HISTORY_LIMIT) || 8;
  let historyMsgs = [];

  if (Array.isArray(conversationTurns) && conversationTurns.length > 0) {
    historyMsgs = conversationTurns.slice(-historyLimit).map(t => ({
      role: t.role === "assistant" ? "assistant" : "user",
      content: String(t.content || "").trim()
    }));
  }

  const cleanIncoming = String(currentIncomingMessage || "").trim();
  const lastMsg = historyMsgs[historyMsgs.length - 1];

  if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== cleanIncoming) {
    if (cleanIncoming) {
      historyMsgs.push({
        role: "user",
        content: cleanIncoming
      });
    }
  }

  if (historyMsgs.length > historyLimit) {
    historyMsgs = historyMsgs.slice(-historyLimit);
  }

  const stdTemp = Number(process.env.STANDARD_TEMPERATURE) || 0.35;
  const maxTokens = Number(process.env.MAX_TOKENS) || 120;

  const formattedMessages = [
    { role: "user", content: `${synthesizedPrompt}\n\n` + historyMsgs.map(m => `${m.role === 'assistant' ? userName : 'User'}: ${m.content}`).join('\n') + `\n${userName}:` }
  ];

  return {
    messages: formattedMessages,
    temperature: stdTemp,
    max_tokens: maxTokens
  };
}

export default {
  buildSystemPrompt,
  prepareDispatchPayload
};
