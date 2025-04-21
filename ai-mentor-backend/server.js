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
  email   : { type:String, required:true, unique:true },
  password: { type:String, required:true }
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

/* ---------- App ---------- */
const app = express();
app.use(express.json());
app.use(cors());

/* ===== AUTH ===== */
app.post("/signup", async (req,res)=>{
  const { email, pass } = req.body;
  if(!email || !pass) return res.json({ success:false, message:"Email & password required" });

  try{
    const exists = await User.findOne({ email:email.trim().toLowerCase() });
    if(exists) return res.json({ success:false, message:"Email already exists" });

    const hash = await bcrypt.hash(pass + extra, 12);
    await new User({ email:email.trim().toLowerCase(), password:hash }).save();
    res.json({ success:true });
  }catch(err){
    console.error(err);
    res.status(500).json({ success:false, message:"Server error" });
  }
});

app.post("/signin", async (req,res)=>{
  const { email, pass } = req.body;
  if(!email || !pass) return res.json({ success:false, message:"Email & password required" });

  try{
    const user = await User.findOne({ email:email.trim().toLowerCase() });
    if(!user) return res.json({ success:false, message:"Invalid credentials" });

    const ok = await bcrypt.compare(pass + extra, user.password);
    if(!ok)   return res.json({ success:false, message:"Invalid credentials" });

    const token = jwt.sign({ userId:user._id, email:user.email }, jwtKey, { expiresIn:"2h" });
    res.json({ success:true, token, userId:user._id });
  }catch(err){
    console.error(err);
    res.status(500).json({ success:false, message:"Server error" });
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

/* ---------- start ---------- */
app.listen(PORT,"0.0.0.0", ()=>console.log("Server running on",PORT));
