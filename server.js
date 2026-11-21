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
let connected = false;
let connectedUsername = null;

app.get("/", (req, res) => {
  res.send("WORD MASTER LIVE bridge is running.");
});

app.get("/status", (req, res) => {
  res.json({ connected, username: connectedUsername });
});

app.get("/control", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WORD MASTER LIVE Control</title>
<style>
body{font-family:Arial;background:#101827;color:white;padding:20px}
main{max-width:500px;margin:auto}
input,button{width:100%;padding:14px;margin:8px 0;box-sizing:border-box;border-radius:8px}
button{background:#16a34a;color:white;border:0;font-weight:bold}
#status{padding:12px;background:#263449;border-radius:8px;margin:12px 0}
#comments{height:300px;overflow:auto;background:#263449;padding:12px;border-radius:8px}
.comment{padding:9px;border-bottom:1px solid #45546b}
</style>
</head>
<body>
<main>
<h2>WORD MASTER LIVE</h2>
<p>TikTok Comment Connection</p>
<input id="username" value="vicfidstories" placeholder="TikTok username">
<button id="connect">CONNECT TO TIKTOK LIVE</button>
<button id="disconnect" style="background:#b91c1c">DISCONNECT</button>
<div id="status">Not connected</div>
<h3>Incoming comments</h3>
<div id="comments"></div>
</main>
<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
const statusBox = document.getElementById("status");
const comments = document.getElementById("comments");

document.getElementById("connect").onclick = async () => {
  statusBox.textContent = "Connecting...";
  try {
    const response = await fetch("/connect", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        username: document.getElementById("username").value
      })
    });
    const result = await response.json();
    statusBox.textContent = result.success
      ? "Connected to @" + result.username
      : "Error: " + result.error;
  } catch (error) {
    statusBox.textContent = "Connection request failed.";
  }
};

document.getElementById("disconnect").onclick = async () => {
  await fetch("/disconnect", {method:"POST"});
};

socket.on("bridge-status", data => {
  statusBox.textContent = data.connected
    ? "Connected to @" + data.username
    : "Not connected to TikTok LIVE";
});

socket.on("tiktok-chat", data => {
  const item = document.createElement("div");
  item.className = "comment";
  item.textContent = "@" + data.username + ": " + data.message;
  comments.prepend(item);
});

socket.on("bridge-error", data => {
  statusBox.textContent = "Error: " + data.message;
});
</script>
</body>
</html>`);
});

app.post("/connect", async (req, res) => {
  const username = String(req.body.username || "")
    .replace(/^@/, "").trim();

  if (!/^[a-zA-Z0-9._]{2,30}$/.test(username)) {
    return res.status(400).json({success:false,error:"Invalid username"});
  }

  try {
    if (connection) {
      await connection.disconnect().catch(() => {});
    }

    connected = false;
    connectedUsername = username;
    connection = new TikTokLiveConnection(username);

    connection.on(ControlEvent.CONNECTED, () => {
      connected = true;
      io.emit("bridge-status", {connected:true,username});
    });

    connection.on(ControlEvent.DISCONNECTED, () => {
      connected = false;
      io.emit("bridge-status", {connected:false,username});
    });

    connection.on(ControlEvent.ERROR, error => {
      const message = error?.info || error?.message || "TikTok connection error";
      io.emit("bridge-error", {message});
    });

    connection.on(WebcastEvent.CHAT, event => {
      io.emit("tiktok-chat", {
        username: event.user?.displayId || event.user?.uniqueId || "unknown",
        nickname: event.user?.nickname || "",
        message: event.content || "",
        time: Date.now()
      });
    });

    await connection.connect();

    connected = true;
    io.emit("bridge-status", {connected:true,username});

    res.json({success:true,username});
  } catch (error) {
    connected = false;
    connection = null;
    connectedUsername = null;
    res.status(500).json({
      success:false,
      error:error.message || "Connection failed"
    });
  }
});

app.post("/disconnect", async (req, res) => {
  if (connection) {
    await connection.disconnect().catch(() => {});
  }
  connection = null;
  connected = false;
  connectedUsername = null;
  io.emit("bridge-status", {connected:false});
  res.json({success:true});
});

io.on("connection", socket => {
  socket.emit("bridge-status", {
    connected,
    username: connectedUsername
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("WORD MASTER LIVE bridge running on port " + PORT);
});

