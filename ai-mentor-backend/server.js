require("dotenv").config();
const express  = require("express");
const mongoose = require("mongoose");
const cors     = require("cors");
const fetch    = require("node-fetch");      // v2
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");

const extra    = process.env.EXTRA_BCRYPT_STRING;
const jwtKey   = process.env.JWT_STRING;
const PORT     = process.env.PORT || 5000;

/* ---------- DB ---------- */
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser:true, useUnifiedTopology:true
})
.then(()=>console.log("MongoDB connected"))
.catch(err=>console.error("Mongo error:",err));

/* ---------- Schemas ---------- */
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

/* one collection per tutor */
const conversationSchema = new mongoose.Schema({
  title:String,
  messages:[{
    sender:String,
    text:String,
    timestamp:{ type:Date, default:Date.now }
  }],
  model:String,
  createdAt:{ type:Date, default:Date.now }
});
function getConversationModel(tutor){
  const name = "Conversation_"+tutor;
  return mongoose.models[name] || mongoose.model(name, conversationSchema, "conversations_"+tutor);
}

const performanceSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  tutor: { type: String, required: true },
  topic: { type: String, required: true },
  subtopic: { type: String, default: 'general' }, // Added subtopic field
  activityType: { type: String, enum: ['flashcard', 'quiz'], required: true },
  cards: [{
    cardId: String,
    question: String,
    answer: String,
    subtopic: { type: String, default: 'general' }, // Added subtopic for cards
    attempts: { type: Number, default: 0 },
    correctAttempts: { type: Number, default: 0 },
    lastAttempt: { type: Date, default: Date.now },
    difficulty: { type: Number, default: 3 }, // 1-5 scale
  }],
  sessions: [{
    date: { type: Date, default: Date.now },
    subtopic: { type: String, default: 'general' }, // Added subtopic for sessions
    cardsStudied: Number,
    correctAnswers: Number,
    timeSpent: Number, // in seconds
  }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

function getPerformanceModel(userId) {
  const name = "Performance_" + userId;
  return mongoose.models[name] || mongoose.model(name, performanceSchema, "performances_" + userId);
}

/* ---------- App ---------- */
const app = express();
app.use(express.json());
app.use(cors());

/* ===== AUTH ===== */
// Sign up route
app.post("/signup", async (req, res) => {
  const { email, pass, fullName } = req.body;
  console.log("Signup request:", { email, fullName });

  if (!email || !pass) {
    return res.json({ success: false, message: "Email & password required" });
  }

  try {
    const exists = await User.findOne({ email: email.trim().toLowerCase() });
    if (exists) {
      return res.json({ success: false, message: "Email already exists" });
    }

    const hash = await bcrypt.hash(pass + extra, 12);
    const newUser = await new User({
      email: email.trim().toLowerCase(),
      password: hash,
      fullName: fullName || email.split('@')[0]
    }).save();

    console.log("User created:", newUser._id);
    res.json({ success: true });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/signin", async (req, res) => {
  const { email, pass } = req.body;
  console.log("Signin request:", { email });

  if (!email || !pass) {
    return res.json({ success: false, message: "Email & password required" });
  }

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      return res.json({ success: false, message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(pass + extra, user.password);
    if (!ok) {
      return res.json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign({
      userId: user._id,
      email: user.email
    }, jwtKey, { expiresIn: "7d" });

    console.log("User authenticated:", user._id);
    res.json({
      success: true,
      token,
      userId: user._id.toString(),
      fullName: user.fullName
    });
  } catch (err) {
    console.error("Signin error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Password reset request
app.post("/reset-password", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.json({ success: false, message: "Email is required" });
  }

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      // For security, don't reveal if the email exists or not
      return res.json({ success: true, message: "If your email is in our system, you'll receive reset instructions" });
    }

    // Generate a password reset token (would implement email sending here)
    // In a real implementation, you would:
    // 1. Generate a unique token
    // 2. Store it in the database with an expiration time
    // 3. Send an email with a link containing the token

    res.json({ success: true, message: "Password reset instructions sent" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ===== Conversations ===== */
app.get("/api/conversations", async (req,res)=>{
  try{
    const tutor = req.query.tutor;
    if(!tutor) return res.status(400).json({ error:"Tutor query parameter is required" });
    const Conv = getConversationModel(tutor);
    const list = await Conv.find().sort({ createdAt:-1 });
    res.json(list);
  }catch(err){ console.error(err); res.status(500).json({ error:"Server error" }); }
});

app.post("/api/conversations", async (req,res)=>{
  try{
    const { title, model, tutor } = req.body;
    if(!tutor) return res.status(400).json({ error:"Tutor is required" });
    const Conv = getConversationModel(tutor);
    const c = await new Conv({ title:title||"", model, messages:[] }).save();
    res.status(201).json(c);
  }catch(err){ console.error(err); res.status(500).json({ error:"Server error" }); }
});

app.post("/api/messages", async (req,res)=>{
  try{
    const { conversationId, sender, text, model, tutor } = req.body;
    if(!tutor) return res.status(400).json({ error:"Tutor is required" });
    const Conv = getConversationModel(tutor);
    const c = await Conv.findById(conversationId);
    if(!c) return res.status(404).json({ error:"Conversation not found" });

    if(c.messages.length === 0 && sender==="user"){
      c.title = text.split(" ").slice(0,5).join(" ");
    }
    c.messages.push({ sender, text });
    c.model = model;
    await c.save();
    res.json(c);
  }catch(err){ console.error(err); res.status(500).json({ error:"Server error" }); }
});

app.delete("/api/conversations/:id", async (req,res)=>{
  try{
    const tutor = req.query.tutor;
    if(!tutor) return res.status(400).json({ error:"Tutor query parameter is required" });
    const Conv = getConversationModel(tutor);
    const del = await Conv.findByIdAndDelete(req.params.id);
    if(!del) return res.status(404).json({ error:"Conversation not found" });
    res.json({ message:"Conversation deleted" });
  }catch(err){ console.error(err); res.status(500).json({ error:"Server error" }); }
});

/* ===== OpenAI proxy ===== */
app.post("/api/openai", async (req,res)=>{
  const { message, model, tutor } = req.body;
  if(!message) return res.status(400).json({ error:"Message is required" });

  /* tutor‑specific system prompt */
  const tutorPrompts = {
    biology : "You are a Biology tutor specialising in genetics, ecology, physiology.",
    python  : "You are a Python programming tutor helping with syntax and debugging.",
    maths   : "You are a Maths tutor covering algebra to calculus.",
    english : "You are an English tutor focusing on grammar and literature."
  };
  const system = tutorPrompts[tutor] || `You are a ${tutor} tutor.`;

  try{
    const mdl   = model || "gpt-3.5-turbo";
    const r = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
      },
      body:JSON.stringify({
        model:mdl,
        messages:[
          { role:"system", content:system },
          { role:"user",   content:message }
        ],
        max_tokens:500,
        temperature:0.7
      })
    });
    if(!r.ok){
      const e = await r.json();
      return res.status(r.status).json({ error:"OpenAI error", details:e });
    }
    const data = await r.json();
    res.json({ response:data.choices[0].message.content });
  }catch(err){
    console.error(err);
    res.status(500).json({ error:"OpenAI request failed" });
  }
});

// Get user performance data
app.get("/api/performance", async (req, res) => {
  try {
    const { userId, tutor, topic, subtopic, activityType } = req.query;
    if (!userId) return res.status(400).json({ error: "UserId is required" });

    console.log('Performance query params:', req.query); // Debug log

    const Performance = getPerformanceModel(userId);
    const query = { userId };
    if (tutor) query.tutor = tutor;
    if (topic) query.topic = topic;
    if (subtopic) query.subtopic = subtopic;
    if (activityType) query.activityType = activityType;

    console.log('Performance MongoDB query:', query); // Debug log

    const performanceData = await Performance.find(query).sort({ updatedAt: -1 });
    console.log(`Found ${performanceData.length} performance records`); // Debug log

    res.json(performanceData);
  } catch (err) {
    console.error('Error in GET /api/performance:', err);
    res.status(500).json({ error: "Server error" });
  }
});

// Update performance after a session
app.post("/api/performance", async (req, res) => {
  try {
    const { userId, tutor, topic, subtopic, activityType, sessionData, cardsData } = req.body;
    console.log('Received performance update:', req.body); // Debug log

    if (!userId || !tutor || !topic || !activityType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const Performance = getPerformanceModel(userId);

    // Find existing performance document or create new one
    let performance = await Performance.findOne({
      userId, tutor, topic, subtopic: subtopic || 'general', activityType
    });

    if (!performance) {
      console.log('Creating new performance record'); // Debug log
      performance = new Performance({
        userId, tutor, topic,
        subtopic: subtopic || 'general',
        activityType,
        cards: [],
        sessions: []
      });
    } else {
      console.log('Updating existing performance record'); // Debug log
    }

    // Add new session data
    if (sessionData) {
      performance.sessions.push({
        date: new Date(),
        subtopic: subtopic || 'general',
        cardsStudied: sessionData.cardsStudied,
        correctAnswers: sessionData.correctAnswers,
        timeSpent: sessionData.timeSpent
      });
    }

    // Update cards data
    if (cardsData && cardsData.length > 0) {
      for (const newCard of cardsData) {
        const existingCardIndex = performance.cards.findIndex(
          card => card.cardId === newCard.cardId
        );

        if (existingCardIndex >= 0) {
          // Update existing card
          const existingCard = performance.cards[existingCardIndex];
          existingCard.attempts += newCard.attempts || 1;
          existingCard.correctAttempts += newCard.correctAttempts || 0;
          existingCard.lastAttempt = new Date();
          existingCard.subtopic = subtopic || existingCard.subtopic || 'general';

          // Adjust difficulty based on correctness
          const successRate = existingCard.correctAttempts / existingCard.attempts;
          if (successRate > 0.8) existingCard.difficulty = Math.max(1, existingCard.difficulty - 1);
          else if (successRate < 0.6) existingCard.difficulty = Math.min(5, existingCard.difficulty + 1);

          performance.cards[existingCardIndex] = existingCard;
        } else {
          // Add new card
          performance.cards.push({
            cardId: newCard.cardId,
            question: newCard.question,
            answer: newCard.answer,
            subtopic: subtopic || 'general',
            attempts: newCard.attempts || 1,
            correctAttempts: newCard.correctAttempts || 0,
            lastAttempt: new Date(),
            difficulty: 3 // Default medium difficulty
          });
        }
      }
    }

    performance.updatedAt = new Date();
    const savedPerformance = await performance.save();
    console.log('Performance saved successfully'); // Debug log

    res.status(201).json(savedPerformance);
  } catch (err) {
    console.error('Error in POST /api/performance:', err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get subtopic progress summary
app.get("/api/progress/subtopics", async (req, res) => {
  try {
    const { userId, tutor } = req.query;
    if (!userId || !tutor) {
      return res.status(400).json({ error: "UserId and tutor are required" });
    }

    const Performance = getPerformanceModel(userId);

    // Get all performance records for this tutor/user
    const performanceData = await Performance.find({ userId, tutor });

    // Get unique subtopics
    const subtopics = [...new Set(
      performanceData.flatMap(perf => [
        perf.subtopic,
        ...perf.cards.map(card => card.subtopic),
        ...perf.sessions.map(session => session.subtopic)
      ]).filter(Boolean)
    )];

    // Calculate progress for each subtopic
    const subtopicProgress = subtopics.map(subtopic => {
      const subtopicPerformance = performanceData.filter(
        perf => perf.subtopic === subtopic ||
              perf.cards.some(card => card.subtopic === subtopic) ||
              perf.sessions.some(session => session.subtopic === subtopic)
      );

      let totalCards = 0;
      let correctCards = 0;
      let sessionsCount = 0;

      subtopicPerformance.forEach(perf => {
        // Count sessions
        sessionsCount += perf.sessions.filter(s => s.subtopic === subtopic).length;

        // Count from cards
        perf.cards.forEach(card => {
          if (card.subtopic === subtopic) {
            totalCards += card.attempts || 0;
            correctCards += card.correctAttempts || 0;
          }
        });

        // Count from sessions
        perf.sessions.forEach(session => {
          if (session.subtopic === subtopic) {
            totalCards += session.cardsStudied || 0;
            correctCards += session.correctAnswers || 0;
          }
        });
      });

      const progressPercentage = totalCards > 0
        ? Math.min(100, Math.round((correctCards / totalCards) * 100))
        : 0;

      // Calculate mastery level (0-5)
      const masteryLevel = totalCards === 0 ? 0 :
        progressPercentage < 40 ? 1 :
        progressPercentage < 60 ? 2 :
        progressPercentage < 75 ? 3 :
        progressPercentage < 90 ? 4 : 5;

      return {
        subtopic,
        progress: progressPercentage,
        masteryLevel,
        totalCards,
        correctCards,
        sessionsCount
      };
    });

    // Calculate overall progress
    const totalProgress = subtopicProgress.length > 0
      ? Math.round(subtopicProgress.reduce((sum, item) => sum + item.progress, 0) / subtopicProgress.length)
      : 0;

    res.json({
      subtopics: subtopicProgress,
      overall: totalProgress
    });

  } catch (err) {
    console.error('Error in GET /api/progress/subtopics:', err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------- start ---------- */
app.listen(PORT,"0.0.0.0", ()=>console.log("Server running on",PORT));