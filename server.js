import express from "express";
import http from "http";
import { Server } from "socket.io";
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent
} from "tiktok-live-connector";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());

let connection = null;
let connectedUsername = null;

app.get("/", (req, res) => {
  res.send("WORD MASTER LIVE bridge is running.");
});

app.get("/status", (req, res) => {
  res.json({
    connected: Boolean(connection?.isConnected),
    username: connectedUsername
  });
});

app.post("/connect", async (req, res) => {
  const username = String(req.body.username || "")
    .replace(/^@/, "")
    .trim();

  if (!/^[a-zA-Z0-9._]{2,30}$/.test(username)) {
    return res.status(400).json({ error: "Invalid TikTok username" });
  }

  try {
    if (connection) {
      await connection.disconnect().catch(() => {});
    }

    connectedUsername = username;
    connection = new TikTokLiveConnection(username);

    connection.on(ControlEvent.ERROR, (error) => {
      io.emit("bridge-error", {
        message: error.info || "TikTok connection error"
      });
    });

    connection.on(WebcastEvent.CHAT, (event) => {
      io.emit("tiktok-chat", {
        username: event.user?.displayId || "unknown",
        nickname: event.user?.nickname || "",
        message: event.content || "",
        time: Date.now()
      });
    });

    await connection.connect();

    io.emit("bridge-status", {
      connected: true,
      username
    });

    res.json({
      success: true,
      message: "Connected to TikTok LIVE",
      username
    });

  } catch (error) {
    connection = null;

    res.status(500).json({
      success: false,
      error: error.message || "Connection failed"
    });
  }
});

app.post("/disconnect", async (req, res) => {
  if (connection) {
    await connection.disconnect().catch(() => {});
  }

  connection = null;
  connectedUsername = null;

  io.emit("bridge-status", { connected: false });

  res.json({ success: true });
});

io.on("connection", (socket) => {
  socket.emit("bridge-status", {
    connected: Boolean(connection?.isConnected),
    username: connectedUsername
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Bridge running on port ${PORT}`);
});
