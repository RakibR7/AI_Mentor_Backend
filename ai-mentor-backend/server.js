// server/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fetch = require('node-fetch'); // Ensure you're using node-fetch@2
require('dotenv').config();

const app = express();  // This needs to be defined at the top
const PORT = process.env.PORT || 5000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("Connected to MongoDB"))
.catch((err) => console.error("MongoDB connection error:", err));

// Conversation Schema (same for all tutors)
const conversationSchema = new mongoose.Schema({
  title: String,
  messages: [{
    sender: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
  }],
  model: String,
  createdAt: { type: Date, default: Date.now }
});

// Helper: Get dynamic Conversation model for a given tutor
function getConversationModel(tutor) {
  const modelName = 'Conversation_' + tutor;
  if (mongoose.models[modelName]) {
    return mongoose.models[modelName];
  }
  // Third parameter is the collection name
  return mongoose.model(modelName, conversationSchema, 'conversations_' + tutor);
}

// Middleware
app.use(express.json());
app.use(cors());

// GET all conversations for a specific tutor
app.get('/api/conversations', async (req, res) => {
  try {
    const tutor = req.query.tutor;
    if (!tutor) {
      return res.status(400).json({ error: 'Tutor query parameter is required' });
    }
    const ConversationModel = getConversationModel(tutor);
    const conversations = await ConversationModel.find().sort({ createdAt: -1 });
    res.json(conversations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new conversation with tutor field
app.post('/api/conversations', async (req, res) => {
  try {
    const { title, model, tutor } = req.body;
    if (!tutor) {
      return res.status(400).json({ error: 'Tutor is required' });
    }
    const ConversationModel = getConversationModel(tutor);
    const newConversation = new ConversationModel({ title: title || "", model, messages: [] });
    await newConversation.save();
    res.status(201).json(newConversation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add message to conversation and update title on first user message
app.post('/api/messages', async (req, res) => {
  try {
    const { conversationId, sender, text, model, tutor } = req.body;
    if (!tutor) {
      return res.status(400).json({ error: 'Tutor is required' });
    }
    const ConversationModel = getConversationModel(tutor);
    const conversation = await ConversationModel.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Update title on the first user message if not already set
    if (conversation.messages.length === 0 && sender === "user") {
      const newTitle = text.split(" ").slice(0, 5).join(" ");
      conversation.title = newTitle;
    }

    conversation.messages.push({ sender, text });
    conversation.model = model;
    await conversation.save();

    res.json(conversation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete conversation (tutor passed as query parameter)
app.delete('/api/conversations/:id', async (req, res) => {
  try {
    const tutor = req.query.tutor;
    if (!tutor) {
      return res.status(400).json({ error: 'Tutor query parameter is required' });
    }
    const ConversationModel = getConversationModel(tutor);
    const conversation = await ConversationModel.findByIdAndDelete(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ message: 'Conversation deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// OpenAI endpoint (updated to handle fine-tuned models)
app.post('/api/openai', async (req, res) => {
  const { message, model, tutor } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // Check if the model is one of your fine-tuned models
    const isFinetuned = model && model.startsWith('ft:');

    // Create a tutor-specific system message
    let systemMessage = '';
    if (tutor === 'biology') {
      systemMessage = 'You are a Biology tutor specializing in teaching biology concepts in an engaging and informative way. Answer questions about biology topics like cells, genetics, evolution, ecology, and human physiology.';
    } else if (tutor === 'python') {
      systemMessage = 'You are a Python programming tutor specializing in teaching coding concepts. Help students understand programming logic, syntax, debugging, and best practices in Python.';
    } else if (tutor === 'maths') {
      systemMessage = 'You are a Mathematics tutor specializing in teaching math concepts from basic arithmetic to advanced calculus, algebra, geometry, and statistics.';
    } else if (tutor === 'english') {
      systemMessage = 'You are an English tutor specializing in teaching grammar, vocabulary, writing, literature analysis, and reading comprehension.';
    } else {
      systemMessage = `You are a ${tutor} tutor specializing in teaching this subject in an engaging, informative way.`;
    }

    // Default to GPT-3.5-turbo if the model is missing or has an error
    const modelToUse = model || "gpt-3.5-turbo";

    console.log(`Using model: ${modelToUse} for tutor: ${tutor}`);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: modelToUse,
        messages: [
          // Always include a system message for better context
          { role: "system", content: systemMessage },
          { role: "user", content: message }
        ],
        max_tokens: 500, // Increased for more detailed responses
        temperature: 0.7 // Adjust as needed for creativity vs. precision
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API Error:', errorData);

      // If there's a model error, fall back to GPT-3.5-turbo
      if (errorData.error?.code === 'model_not_found') {
        console.log('Model not found, falling back to gpt-3.5-turbo');

        const fallbackResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: systemMessage },
              { role: "user", content: message }
            ],
            max_tokens: 500,
            temperature: 0.7
          })
        });

        if (!fallbackResponse.ok) {
          const fallbackError = await fallbackResponse.json();
          return res.status(fallbackResponse.status).json({
            error: 'OpenAI API Error (fallback failed)',
            details: fallbackError.error?.message || 'Unknown error'
          });
        }

        const fallbackData = await fallbackResponse.json();
        return res.json({ response: fallbackData.choices[0].message.content });
      }

      return res.status(response.status).json({
        error: 'OpenAI API Error',
        details: errorData.error?.message || 'Unknown error'
      });
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0]?.message?.content) {
      console.error('Unexpected API response:', data);
      return res.status(500).json({
        error: 'Unexpected response structure from OpenAI'
      });
    }

    res.json({ response: data.choices[0].message.content });
  } catch (error) {
    console.error('Error communicating with OpenAI:', error);
    res.status(500).json({
      error: 'Error communicating with OpenAI',
      details: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
