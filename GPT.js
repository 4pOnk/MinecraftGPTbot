const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function runChat() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Write a haiku about Node.js" },
      ],
    });

    console.log(completion.choices[0].message.content);
  } catch (error) {
    console.error("Error:", error);
  }
}

runChat();
