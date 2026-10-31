// File: backend/services/canned.service.js
// Purpose: Intercepts common conversational greetings, typos, and chitchat to return instant responses without consuming LLM compute.

const WORD_REPLACEMENTS = {
  yo: "you",
  u: "you",
  yu: "you",
  yuo: "you",
  ya: "you",
  ur: "your",
  r: "are",
  ar: "are",
  er: "are",
  wat: "what",
  wht: "what",
  wats: "what is",
  whats: "what is",
  hw: "how",
  hwo: "how",
  hows: "how is",
  whos: "who is",
  doin: "doing",
  doign: "doing",
  helo: "hello",
  hellow: "hello",
  hlo: "hello",
  hlw: "hello",
  hye: "hey",
  thx: "thanks",
  thnx: "thanks",
  thanx: "thanks",
  tq: "thanks",
  ty: "thanks",
  plz: "please",
  pls: "please",
};

function normalizeQuery(text) {
  if (typeof text !== "string") return "";
  // Strip punctuation and normalize spaces
  const clean = text
    .toLowerCase()
    .replace(/[?!.,;:`'~"/\-_+*#@^&()[\]{}|<>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Replace common slang and typo tokens
  return clean
    .split(" ")
    .map((word) => WORD_REPLACEMENTS[word] || word)
    .join(" ");
}

const CANNED_RULES = [
  {
    category: "activity",
    patterns: [
      /^what (is |are )?you (doing|up to)$/,
      /^what you doing$/,
      /^what doing$/,
      /^what is up$/,
      /^sup$/,
    ],
    response: {
      summary: "I'm standing by to help you search and understand your document knowledge base.",
      points: [
        "Feel free to ask any question about your uploaded policies or webpages!",
      ],
    },
  },
  {
    category: "greeting",
    patterns: [
      /^(hi|hello|hey|hiya|hola|namaste|howdy)( (there|buddy|know|know ai|assistant))?$/,
      /^good (morning|afternoon|evening|day)$/,
      /^greetings$/,
    ],
    response: {
      summary: "Hello! How can I assist you today?",
      points: [
        "Ask questions about your uploaded PDF, Markdown, or TXT documents",
        "Query any webpage or online policy you've imported in Settings",
        "Get grounded answers with direct citations to original sources",
      ],
    },
  },
  {
    category: "wellbeing",
    patterns: [
      /^how (are|is) you( doing| today)?$/,
      /^how you doing$/,
      /^how is it going$/,
      /^how are things$/,
      /^how do you do$/,
      /^are you (good|fine|okay|ok)$/,
    ],
    response: {
      summary: "I'm doing great, thank you for asking! I'm ready to help you analyze your documents.",
      points: [
        "What document or policy would you like to explore today?",
      ],
    },
  },
  {
    category: "identity",
    patterns: [
      /^who (are|is) you$/,
      /^what (are|is) you$/,
      /^who you$/,
      /^what is your name$/,
      /^tell me about yourself$/,
    ],
    response: {
      summary: "I am Know AI, your local document intelligence assistant.",
      points: [
        "I extract and index text from PDFs, text files, and live web pages",
        "I use semantic search to find the exact passages that answer your questions",
        "All your files and data remain stored privately in your local workspace",
      ],
    },
  },
  {
    category: "capabilities",
    patterns: [
      /^what can you do$/,
      /^what you can do$/,
      /^how can you help( me)?$/,
      /^what do you do$/,
      /^(help|features|capabilities)$/,
    ],
    response: {
      summary: "I can help you analyze, search, and answer questions across your documents and policies:",
      points: [
        "Upload files: Drag and drop PDF, TXT, or Markdown documents in the Documents tab",
        "Import URLs: Enter live policy or article web pages in the Settings tab",
        "Instant Q&A: Ask questions in plain English and receive sourced, bulleted answers",
        "Source viewer: Click any citation to inspect the original PDF page or web section",
      ],
    },
  },
  {
    category: "gratitude",
    patterns: [
      /^(thank you|thanks)( (so much|a lot|very much))?$/,
      /^(much appreciated|appreciate it)$/,
    ],
    response: {
      summary: "You're very welcome! Let me know if you have any more questions about your documents.",
      points: [],
    },
  },
  {
    category: "farewell",
    patterns: [
      /^(bye|goodbye|cya|see (you|ya)|see you later|talk to you later|good night|have a (good|great) day)$/,
    ],
    response: {
      summary: "Goodbye! Have a great day, and feel free to return whenever you need document insights.",
      points: [],
    },
  },
  {
    category: "affirmation",
    patterns: [
      /^(cool|great|awesome|nice|sweet|perfect|ok|okay|sounds good|well done|good job)$/,
    ],
    response: {
      summary: "Glad to help! Let me know what you'd like to check next.",
      points: [],
    },
  },
];

function getCannedResponse(question) {
  const normalized = normalizeQuery(question);
  if (!normalized) return null;

  for (const rule of CANNED_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        return {
          answer: rule.response.points.length
            ? `${rule.response.summary}\n\n${rule.response.points.map((p) => `- ${p}`).join("\n")}`
            : rule.response.summary,
          summary: rule.response.summary,
          points: rule.response.points,
          status: "ANSWERED",
          missing_information: null,
          citations: [],
          is_conversational: true,
          retrieval: { count: 0, distances: [] },
        };
      }
    }
  }

  return null;
}

module.exports = { getCannedResponse, normalizeQuery };
