/**
 * Local play server. Run: node server.js
 * Then play at the URL it prints (also opens your browser).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function safeFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return null;
  return file;
}

const server = http.createServer(function (req, res) {
  const file = safeFile(req.url);
  if (!file) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

server.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is already in use. Close the other server, or run:");
    console.error("  set PORT=3001 && node server.js");
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", function () {
  const url = "http://localhost:" + PORT + "/";
  console.log("Soccer Chess is running at " + url);
  console.log("Leave this window open while you play. Press Ctrl+C to stop.");
  exec('cmd /c start "" "' + url + '"');
});
