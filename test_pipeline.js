import assert from "assert";
import { retrieveTriStreamContext } from "./services/triStreamRetriever.js";
import { prepareDispatchPayload, buildSystemPrompt } from "./services/promptAssembler.js";
import { processOutput } from "./services/postProcessor.js";
import { getContactMemory, updateContactMemory } from "./services/contactMemoryService.js";

async function runPipelineIntegrationTests() {
  console.log("🚀 Starting Integration Tests...\n");

  // --- Test 1: Context Retrieval ---
  console.log("Test 1: Testing Context Retrieval...");
  const triStreamData = await retrieveTriStreamContext("123456789", "test_user", "hello bro");
  
  assert(triStreamData.streamA, "Stream A should exist");
  assert(triStreamData.streamB, "Stream B should exist");
  assert.strictEqual(triStreamData.streamA.tier, "close_friend");
  assert(triStreamData.streamB.identity.name, "Bilal Shemsu");
  console.log("✅ Context Retrieval Test Passed!\n");

  // --- Test 2: System Prompt Synthesis ---
  console.log("Test 2: Testing System Prompt Synthesis...");
  const synthesizedPrompt = buildSystemPrompt(triStreamData);
  assert(synthesizedPrompt.includes("Bilal Shemsu"), "Prompt should contain Bilal Shemsu");
  assert(synthesizedPrompt.includes("UNBREAKABLE HUMAN PERSONA DIRECTIVES"), "Prompt should contain persona directives section");
  console.log("✅ System Prompt Synthesis Test Passed!\n");

  // --- Test 3: Dispatch Payload Preparation ---
  console.log("Test 3: Testing Dispatch Payload Construction...");
  const payload = prepareDispatchPayload(triStreamData, [], "hello bro");
  assert.strictEqual(payload.temperature, 0.35);
  assert.strictEqual(payload.max_tokens, 120);
  assert.strictEqual(payload.messages[0].role, "user");
  assert(payload.messages[0].content.includes("hello bro"));
  console.log("✅ Dispatch Payload Construction Test Passed!\n");

  // --- Test 4: Post-Processing & Multi-Bubble Delivery Parser ---
  console.log("Test 4: Testing Post-Processor Multi-Bubble & Punctuation Calibration...");
  const rawLlmText = "As an AI language model, i hope this helps!\n\nhey man, all good.\n\nworking on client app.";
  const bubbles = processOutput(rawLlmText);
  console.log("Processed Bubbles:", bubbles);

  assert(Array.isArray(bubbles), "Bubbles should be an array");
  assert.strictEqual(bubbles.length, 2);
  assert.strictEqual(bubbles[0], "hey man, all good");
  assert.strictEqual(bubbles[1], "working on client app");
  console.log("✅ Post-Processor & Multi-Bubble Delivery Test Passed!\n");

  // --- Test 5: Contact Memory Service ---
  console.log("Test 5: Testing Contact Memory Service...");
  updateContactMemory("test_contact_123", "what stack are you using?", "next.js and node mostly");
  const mem = getContactMemory("test_contact_123");
  assert(mem.recentReplies.includes("next.js and node mostly"), "Memory should retain sent reply");
  console.log("✅ Contact Memory Service Test Passed!\n");

  console.log("🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! ✅");
}

runPipelineIntegrationTests().catch(err => {
  console.error("❌ Integration Test Failed:", err);
  process.exit(1);
});
