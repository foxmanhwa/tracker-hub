const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/trackerhub";

mongoose.connect(MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB connection error:", err));

const aiToolSchema = new mongoose.Schema({
  name: String,
  description: String,
  source: String,
  url: String,
  date: Date,
  category: String,
  views: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  saves: { type: Number, default: 0 },
  popularity: { type: Number, default: 0 },
  trending: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  name: String,
  role: { type: String, default: "user" },
  premium: { type: Boolean, default: false }
});

const watchlistSchema = new mongoose.Schema({
  userId: String,
  toolId: String,
  createdAt: { type: Date, default: Date.now }
});

const notificationSchema = new mongoose.Schema({
  userId: String,
  toolId: String,
  message: String,
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const AiTool = mongoose.model("AiTool", aiToolSchema);
const User = mongoose.model("User", userSchema);
const Watchlist = mongoose.model("Watchlist", watchlistSchema);
const Notification = mongoose.model("Notification", notificationSchema);

async function seedDefaultUser() {
  const admin = await User.findOne({ email: "admin@trackerhub.com" });
  if (!admin) {
    await User.create({
      email: "admin@trackerhub.com",
      password: "admin",
      name: "Admin",
      role: "admin",
      premium: true
    });
  }

  const demo = await User.findOne({ email: "user@example.com" });
  if (!demo) {
    await User.create({
      email: "user@example.com",
      password: "user",
      name: "Demo User",
      role: "user",
      premium: false
    });
  }
}

function recencyBoost(date) {
  const ageDays = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 30 - ageDays);
}

async function ensureTrendingNotifications(toolIds) {
  const topToolIds = toolIds.map(t => t._id.toString());
  const watchlistEntries = await Watchlist.find({ toolId: { $in: topToolIds } });

  for (const entry of watchlistEntries) {
    const tool = toolIds.find(t => t._id.toString() === entry.toolId.toString());
    if (!tool) continue;

    const existing = await Notification.findOne({
      userId: entry.userId,
      toolId: entry.toolId,
      message: new RegExp(tool.name, "i"),
      read: false
    });

    if (!existing) {
      await Notification.create({
        userId: entry.userId,
        toolId: entry.toolId,
        message: `🔥 Your saved tool '${tool.name}' is trending!`,
        read: false
      });
    }
  }
}

async function fetchHackerNews() {
  try {
    const res = await axios.get("https://hn.algolia.com/api/v1/search?query=AI");
    const tools = res.data.hits.map(item => ({
      name: item.title || "Untitled AI",
      description: item.story_text || item.comment_text || "No description",
      source: "Hacker News",
      url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
      date: item.created_at,
      category: "General AI",
      popularity: item.points || 1,
      trending: item.points || 1
    }));

    for (let tool of tools) {
      const existing = await AiTool.findOne({ url: tool.url });
      if (existing) {
        existing.name = tool.name;
        existing.description = tool.description;
        existing.source = tool.source;
        existing.date = tool.date;
        existing.category = tool.category;
        existing.popularity = tool.popularity;
        existing.trending = tool.trending;
        existing.updatedAt = new Date();
        await existing.save();
      } else {
        await AiTool.create({
          ...tool,
          views: 0,
          clicks: 0,
          saves: 0,
          createdAt: tool.date || new Date(),
          updatedAt: new Date()
        });
      }
    }

    console.log("Fetched AI tools from HN", tools.length);
  } catch (err) {
    console.error("Error fetching HN:", err.message);
  }
}

cron.schedule("*/10 * * * *", fetchHackerNews);

app.get("/api/ai-tools", async (req, res) => {
  const tools = await AiTool.find().sort({ createdAt: -1 }).lean();
  res.json(tools);
});

app.get("/api/ai-tools/popular", async (req, res) => {
  const tools = await AiTool.find().lean();

  const scored = tools.map(tool => {
    const score = (tool.views || 0) * 1 + (tool.clicks || 0) * 2 + (tool.saves || 0) * 3 + recencyBoost(tool.date || tool.createdAt);
    return { ...tool, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 20);

  await ensureTrendingNotifications(top);

  res.json(top);
});

app.post("/api/ai-tools/:id/view", async (req, res) => {
  const { id } = req.params;
  const tool = await AiTool.findById(id);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  tool.views += 1;
  await tool.save();
  res.json(tool);
});

app.post("/api/ai-tools/:id/click", async (req, res) => {
  const { id } = req.params;
  const tool = await AiTool.findById(id);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  tool.clicks += 1;
  await tool.save();
  res.json(tool);
});

app.post("/api/watchlist/add", async (req, res) => {
  const { userId, toolId } = req.body;
  if (!userId || !toolId) return res.status(400).json({ error: "userId and toolId required" });

  const exists = await Watchlist.findOne({ userId, toolId });
  if (exists) return res.status(200).json({ message: "Already in watchlist" });

  const tool = await AiTool.findById(toolId);
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  await Watchlist.create({ userId, toolId });
  tool.saves = (tool.saves || 0) + 1;
  await tool.save();

  await Notification.create({
    userId,
    toolId,
    message: `⭐ Added '${tool.name}' to your watchlist`,
    read: false
  });

  res.json({ success: true, tool });
});

app.post("/api/watchlist/remove", async (req, res) => {
  const { userId, toolId } = req.body;
  if (!userId || !toolId) return res.status(400).json({ error: "userId and toolId required" });

  await Watchlist.deleteOne({ userId, toolId });

  const tool = await AiTool.findById(toolId);
  if (tool) {
    tool.saves = Math.max(0, (tool.saves || 1) - 1);
    await tool.save();
  }

  res.json({ success: true });
});

app.get("/api/watchlist", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const list = await Watchlist.find({ userId }).lean();
  const toolIds = list.map(i => i.toolId);
  const tools = await AiTool.find({ _id: { $in: toolIds } });

  res.json(tools);
});

app.get("/api/notifications", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const notes = await Notification.find({ userId }).sort({ createdAt: -1 }).lean();
  res.json(notes);
});

app.post("/api/notifications/read", async (req, res) => {
  const { userId, notificationId, all } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  if (all) {
    await Notification.updateMany({ userId }, { $set: { read: true } });
    return res.json({ success: true });
  }

  if (!notificationId) return res.status(400).json({ error: "notificationId required" });

  await Notification.updateOne({ _id: notificationId, userId }, { $set: { read: true } });
  res.json({ success: true });
});

app.listen(5000, async () => {
  console.log("Server running on http://localhost:5000");
  await seedDefaultUser();
  fetchHackerNews();
});
