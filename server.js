import express from "express";
import http from "http";
import { Server } from "socket.io";
import {
  TikTokLiveConnection,
  WebcastEvent,
} from "tiktok-live-connector";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());

let connection = null;
let connectedUsername = null;
let connecting = false;

app.get("/", (req, res) => {
  res.send("WORD MASTER LIVE bridge is running.");
});

app.get("/status", (req, res) => {
  res.json({
    connected: Boolean(connection?.isConnected),
    connecting,
    username: connectedUsername,
  });
});

app.get("/control", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WORD MASTER LIVE Control</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #111827;
      color: white;
      padding: 18px;
    }
    input, button {
      width: 100%;
      box-sizing: border-box;
      padding: 14px;
      margin: 7px 0;
      font-size: 16px;
      border-radius: 8px;
      border: none;
    }
    button {
      background: #16a34a;
      color: white;
      font-weight: bold;
    }
    button.disconnect {
      background: #dc2626;
    }
    #status {
      padding: 12px;
      background: #273449;
      border-radius: 8px;
      margin: 12px 0;
    }
    #comments {
      background: #273449;
      padding: 12px;
      min-height: 180px;
      border-radius: 8px;
      overflow-wrap: anywhere;
    }
    .comment {
      border-bottom: 1px solid #526078;
      padding: 8px 0;
    }
  </style>
</head>
<body>
  <h2>WORD MASTER LIVE</h2>
  <p>TikTok LIVE comment connection</p>

  <label>TikTok username (without @)</label>
  <input id="username" value="vicfidstories">

  <button onclick="connectTikTok()">CONNECT</button>
  <button class="disconnect" onclick="disconnectTikTok()">DISCONNECT</button>

  <div id="status">Status: Not connected</div>

  <h3>Incoming comments</h3>
  <div id="comments">Waiting for comments...</div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const statusBox = document.getElementById("status");
    const commentsBox = document.getElementById("comments");

    socket.on("bridge-status", (data) => {
      statusBox.textContent =
        "Status: " + (data.connected ? "Connected to @" + data.username : "Not connected");
    });

    socket.on("tiktok-chat", (data) => {
      if (commentsBox.textContent === "Waiting for comments...") {
        commentsBox.textContent = "";
      }

      const item = document.createElement("div");
      item.className = "comment";

      const name = document.createElement("strong");
      name.textContent = data.username + ": ";

      const message = document.createElement("span");
      message.textContent = data.comment;

      item.appendChild(name);
      item.appendChild(message);
      commentsBox.prepend(item);
    });

    async function connectTikTok() {
      const username = document.getElementById("username").value.trim().replace(/^@/, "");

      if (!username) {
        alert("Enter your TikTok username.");
        return;
      }

      statusBox.textContent = "Status: Connecting...";

      try {
        const response = await fetch("/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Connection failed.");
        }

        statusBox.textContent = result.message;
      } catch (error) {
        statusBox.textContent = "Error: " + error.message;
      }
    }

    async function disconnectTikTok() {
      try {
        const response = await fetch("/disconnect", {
          method: "POST"
        });

        const result = await response.json();
        statusBox.textContent = result.message;
      } catch (error) {
        statusBox.textContent = "Error: " + error.message;
      }
    }
  </script>
</body>
</html>
  `);
});

app.post("/connect", async (req, res) => {
  const username = String(req.body.username || "")
    .trim()
    .replace(/^@/, "");

  if (!username) {
    return res.status(400).json({
      error: "TikTok username is required."
    });
  }

  if (connecting) {
    return res.status(409).json({
      error: "A connection attempt is already running."
    });
  }

  if (connection?.isConnected) {
    return res.status(409).json({
      error: "Disconnect the current account before connecting another."
    });
  }

  connecting = true;

  try {
    connection = new TikTokLiveConnection(username, {
      processInitialData: false,
      fetchRoomInfoOnConnect: true,
      enableExtendedGiftInfo: false
    });

    connectedUsername = username;

    connection.on(WebcastEvent.CHAT, (data) => {
      const commentData = {
        username:
          data.user?.uniqueId ||
          data.user?.nickname ||
          "Unknown",
        comment: data.comment || "",
        timestamp: Date.now()
      };

      io.emit("tiktok-chat", commentData);

      console.log(
        commentData.username + ": " + commentData.comment
      );
    });

    connection.on("disconnected", () => {
      console.log("TikTok disconnected.");

      io.emit("bridge-status", {
        connected: false,
        username: connectedUsername
      });
    });

    connection.on("error", (error) => {
      console.error("TikTok connection error:", error);
    });

    await connection.connect();

    connecting = false;

    io.emit("bridge-status", {
      connected: true,
      username
    });

    return res.json({
      success: true,
      message: "Connected to @" + username
    });

  } catch (error) {
    console.error("Connection failed:", error);

    connecting = false;
    connection = null;
    connectedUsername = null;

    io.emit("bridge-status", {
      connected: false,
      username: null
    });

    return res.status(500).json({
      error: error.message || "Could not connect to TikTok LIVE."
    });
  }
});

app.post("/disconnect", async (req, res) => {
  try {
    if (connection) {
      await connection.disconnect();
    }

    connection = null;
    connectedUsername = null;
    connecting = false;

    io.emit("bridge-status", {
      connected: false,
      username: null
    });

    return res.json({
      success: true,
      message: "TikTok disconnected."
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Could not disconnect."
    });
  }
});

io.on("connection", (socket) => {
  socket.emit("bridge-status", {
    connected: Boolean(connection?.isConnected),
    username: connectedUsername
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("WORD MASTER LIVE bridge running on port " + PORT);
});

