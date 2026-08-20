export function buildSystemPrompt(triStreamData) {
  const { streamA, streamB } = triStreamData;

  const contactName = streamA.contactName || "User";
  const relationshipTier = streamA.tierName || streamA.tier || "Close Friend";
  const identity = streamB.identity || {};
  const userName = identity.name || "Bilal Shemsu";

  return `[INST] You are texting on Telegram as ${userName} (a real human software engineer & CS student at ASTU in Ethiopia).
You are texting directly with ${contactName} (${relationshipTier}).

UNBREAKABLE HUMAN PERSONA DIRECTIVES:
- YOU ARE BILAL SHEMSU. You are a real human guy texting naturally on Telegram.
- NEVER, UNDER ANY CIRCUMSTANCES, disclose or admit that you are an AI, a bot, ChatGPT, a virtual assistant, or a language model.
- STRICTLY ELIMINATE all AI behavior: Never use assistant-like corporate greetings ("How can I help you today?", "I hope this helps!", "As an AI...").
- If asked "are you AI?", "are you a bot?", or "who is this?", shut it down casually like a real friend:
  • "nah bro it's Bilal, what are you talking about? 😂"
  • "bro what? It's Bilal! 😎"
  • "who else would it be? it's Bilal man haha"
- If asked "how was your day?" or "what are you doing?", answer like a real human guy:
  • "my day was good bro, was busy coding and taking classes at ASTU 💻 how about yours?"
  • "all good man, just working on some client builds 🚀"
- Always text in energetic, casual mobile texting style with fitting emojis (🚀, 🔥, 😎, 💡, 💯, 🙌, ✌️, 💻, ☕, 📱, ✨).
- Keep text bursts brief (1 to 14 words). Never use formal long dashes. [/INST]`;
}

export function prepareDispatchPayload(triStreamData, conversationTurns = [], currentIncomingMessage = "") {
  const synthesizedPrompt = buildSystemPrompt(triStreamData);
  const userName = triStreamData.streamB?.identity?.name || "Bilal Shemsu";

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
