// index.js
const express = require("express");
const fileUpload = require("express-fileupload");
const { Client, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const XLSX = require("xlsx");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

// ✅ Setup Express + Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024 } })); // limit 25MB
app.use(express.static("public"));

// ✅ Create uploads folder if not exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// ✅ Initialize WhatsApp client
const client = new Client({
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
            executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',

  },
  webVersionCache: { type: "none" },
});

// ✅ Emit QR code to frontend
client.on("qr", async (qr) => {
  console.log("📲 Scan this QR with your WhatsApp.");
  const qrImageUrl = await qrcode.toDataURL(qr);
  io.emit("qr", qrImageUrl);
});

// ✅ Ready event
client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
  io.emit("ready", true);
});

// ✅ Reconnect with delay if disconnected
client.on("disconnected", (reason) => {
  console.log("❌ WhatsApp disconnected:", reason);
  setTimeout(() => {
    console.log("🔄 Reinitializing WhatsApp client...");
    client.initialize();
  }, 5000);
});

// ✅ Helper: sleep for delay
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ✅ API endpoint for sending messages
app.post("/send", async (req, res) => {
  try {
    // Ensure client is ready
    if (!client.info || !client.info.wid) {
      return res.status(400).json({ error: "WhatsApp not ready. Please scan QR." });
    }

    let numbers = [];

    // Numbers from textarea
    if (req.body.numbers?.trim()) {
      numbers = req.body.numbers.split(",").map((n) => n.trim());
    }

    // Numbers from Excel file
    if (req.files?.excel) {
      const workbook = XLSX.read(req.files.excel.data, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      const excelNumbers = data
        .map((row) => String(row[Object.keys(row)[0]] || "").trim())
        .filter((val) => /^\d+$/.test(val));
      numbers = numbers.concat(excelNumbers);
    }

    // ✅ Normalize numbers (add +91 etc)
    numbers = [...new Set(
      numbers
        .map((n) => n.replace(/\D/g, ""))
        .filter((n) => n.length >= 10)
        .map((n) => (n.startsWith("91") ? `+${n}` : `+91${n.slice(-10)}`))
    )];

    if (!numbers.length) {
      return res.status(400).json({ error: "No valid numbers found." });
    }

    // ✅ Compose message
    let message = req.body.message || "";
//     message += `

// 🟩 *📞 CALL US 9723625050*  
// 🟩 🌐 *VISIT NOW* https://www.promiseacademy.co.in/`;

    const mediaFile = req.files?.media || null;

    if (!message.trim() && !mediaFile) {
      return res.status(400).json({ error: "Message or media is required." });
    }

    const msgDelay = Math.max(parseInt(req.body.delay) || 2000, 1500);
    let sentCount = 0,
      skippedCount = 0,
      failedCount = 0;

    (async () => {
      const total = numbers.length;
      for (let i = 0; i < total; i++) {
        const number = numbers[i];
        const chatId = number.replace("+", "") + "@c.us";

        try {
          const isRegistered = await client.isRegisteredUser(chatId);
          if (!isRegistered) {
            skippedCount++;
            io.emit("status", `⚠️ Skipped ${number} (not on WhatsApp)`);
            continue;
          }

          // ✅ Handle media
          if (mediaFile) {
            if (
              !mediaFile.mimetype.startsWith("video/") &&
              !mediaFile.mimetype.startsWith("image/")
            ) {
              io.emit("status", `⚠️ Skipped ${number} (invalid file type)`);
              skippedCount++;
              continue;
            }

            if (mediaFile.size > 16 * 1024 * 1024) {
              io.emit("status", `⚠️ Skipped ${number} (file >16MB)`);
              skippedCount++;
              continue;
            }

            const uploadPath = path.join(uploadsDir, mediaFile.name);
            await mediaFile.mv(uploadPath);
const base64 = fs.readFileSync(uploadPath, { encoding: "base64" });
const media = new MessageMedia(mediaFile.mimetype, base64, mediaFile.name);
            // const base64Data = fs.readFileSync(uploadPath).toString("base64");
            // const media = new MessageMedia(mediaFile.mimetype, base64Data, mediaFile.name);

            await client.sendMessage(chatId, media, { caption: message });
            fs.unlinkSync(uploadPath); // cleanup
          } else {
            await client.sendMessage(chatId, message);
          }

          sentCount++;
          io.emit("status", `✅ (${i + 1}/${total}) Sent to ${number}`);
        } catch (err) {
            console.error("❌ Send error:", err);
          console.error("❌ Send error:", err.message);
          failedCount++;
          io.emit("status", `❌ (${i + 1}/${total}) Failed to send to ${number}`);
        }

        await delay(msgDelay);
      }

      io.emit(
        "status",
        `🎉 Done! ✅ Sent: ${sentCount}, ⚠️ Skipped: ${skippedCount}, ❌ Failed: ${failedCount}`
      );
    })();

    res.json({ status: "sending", total: numbers.length });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ Initialize client
client.initialize();

// ✅ Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
