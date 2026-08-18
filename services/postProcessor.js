export function processOutput(rawText) {
  if (!rawText || typeof rawText !== "string") return [];

  // Unicode & quote normalization
  let text = rawText
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\u2014\u2013]|--/g, ", ")
    .replace(/,\s*,+/g, ",")
    .trim();

  // Strip AI disclosure leaks
  const leakPatterns = [
    /^(how can i (assist|help) (you|today)[^.!?\n]*[.!?]?\s*)/ui,
    /^(i hope this (helps|finds you well)[,!.]?\s*)/i,
    /^(as an ai|i am an ai|as an ai language model)[,!.]?\s*/i,
    /\b(as an ai|i am an ai|language model|ai assistant|ai sidekick|in this roleplay|pretending to be|because i'?m ai|because i'?m an ai)\b/gi,
    /\b(i hope this helps[!.]?)\s*/gi,
    /\b(let me know if you (need|have) any (other|further) (questions|assistance))[!.]*\s*/gi,
    /\b(since i'?m an ai[^.!?]*[.!?]?)\s*/gi,
    /\bi don'?t have feelings or experiences[^.!?]*[.!?]?\s*/gi,
    /\bhow can i assist you today\??\s*/gi
  ];

  let prev;
  do {
    prev = text;
    leakPatterns.forEach((regex) => { text = text.replace(regex, ''); });
    text = text.replace(/^[\s,.!?-]+/, '').trim();
  } while (text !== prev);

  text = text.trim();

  // Convert Markdown to Telegram-native HTML
  text = text.replace(/^#{1,6}\s*(.+)$/gm, "<b>$1</b>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.*?)__/g, "<b>$1</b>");
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/```[a-z]*\n([\s\S]*?)```/gi, "<pre>$1</pre>");

  // Multi-bubble parser
  let bubbles = text
    .split(/\n\n+/)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  if (bubbles.length > 3) {
    bubbles = bubbles.slice(0, 3);
  }

  // Punctuation calibration
  bubbles = bubbles.map(b => {
    if (b.split(/\s+/).length <= 12 && b.endsWith('.') && !b.endsWith('..') && !b.includes('<a href=')) {
      return b.slice(0, -1);
    }
    return b;
  });

  if (!bubbles || bubbles.length === 0) {
    return [rawText.trim()];
  }

  return bubbles;
}

export default {
  processOutput
};
