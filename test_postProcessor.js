import { processOutput } from "./services/postProcessor.js";
import assert from "assert";

console.log("Running postProcessor unit tests...");

// Test 1: AI Disclosure Leak Stripping
const input1 = "As an AI language model, I hope this helps! Here is the info\n\nLet me know if you need anything else.";
const output1 = processOutput(input1);
console.log("Test 1 output:", output1);
assert(Array.isArray(output1), "Output should be an array");
assert(!output1[0].toLowerCase().includes("as an ai"), "Should strip AI disclaimer");

// Test 2: Punctuation Calibration (period stripping on short bursts <= 12 words)
const input2 = "dehna man bro.\n\nworking on client project.";
const output2 = processOutput(input2);
console.log("Test 2 output:", output2);
assert.strictEqual(output2[0], "dehna man bro");
assert.strictEqual(output2[1], "working on client project");

// Test 3: Preserve ellipsis and non-short punctuation
const input3 = "wait a sec...";
const output3 = processOutput(input3);
console.log("Test 3 output:", output3);
assert.strictEqual(output3[0], "wait a sec...");

// Test 4: Multi-bubble chunker on double newlines (\n\n)
const input4 = "first bubble text\n\nsecond bubble text\n\nthird bubble text";
const output4 = processOutput(input4);
console.log("Test 4 output:", output4);
assert.strictEqual(output4.length, 3);
assert.strictEqual(output4[0], "first bubble text");
assert.strictEqual(output4[1], "second bubble text");
assert.strictEqual(output4[2], "third bubble text");

// Test 5: Unicode quote normalization
const input5 = "‘selam’ “bro”";
const output5 = processOutput(input5);
console.log("Test 5 output:", output5);
assert.strictEqual(output5[0], "'selam' \"bro\"");

console.log("All postProcessor unit tests passed successfully! ✅");
