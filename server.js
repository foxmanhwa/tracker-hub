const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const cors = require("cors");

const app = express();
app.use(cors());

let aiTools = []; // in-memory storage

// Fetch from Hacker News (AI-related)
async function fetchHackerNews() {
  try {
    const res = await axios.get(
      "https://hn.algolia.com/api/v1/search?query=AI"
    );

    const data = res.data.hits.map(item => ({
      name: item.title || "Untitled AI",
      description: item.story_text || item.comment_text || "No description",
      source: "Hacker News",
      url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
      date: item.created_at,
      category: "General AI",
      popularity: item.points || 1,
      trending: item.points || 1
    }));

    aiTools = [...data];
    console.log("Fetched AI tools from HN", aiTools.length);
  } catch (err) {
    console.error("Error fetching HN:", err.message);
  }
}

// Run every 10 minutes
cron.schedule("*/10 * * * *", fetchHackerNews);

// API endpoint
app.get("/api/ai-tools", (req, res) => {
  res.json(aiTools);
});

// Start server
app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
  fetchHackerNews(); // initial fetch
});
