// index.js
const express = require("express");
const fileUpload = require("express-fileupload");
const { Client, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode"); // ✅ use qrcode to create base64 QR
const XLSX = require("xlsx");
const http = require("http");
const { Server } = require("socket.io");

const PORT = 3000;

// Create express app + server
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(fileUpload());
app.use(express.static("public")); // put your index.html in /public folder

// WhatsApp client initialization
const client = new Client({
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// Emit QR to frontend
client.on("qr", async (qr) => {
  console.log("📲 New QR generated. Scan with WhatsApp.");
  const qrImageUrl = await qrcode.toDataURL(qr); // generate base64 QR
  io.emit("qr", qrImageUrl);
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
  io.emit("ready", true);
});

// Restart if disconnected
client.on("disconnected", () => {
  console.log("❌ WhatsApp disconnected. Reinitializing...");
  client.initialize();
});

// API endpoint for sending messages
app.post("/send", async (req, res) => {
  try {
    let numbers = [];

    // Numbers from textarea
    if (req.body.numbers?.trim()) {
      numbers = req.body.numbers.split(",").map((n) => n.trim());
    }

    // Numbers from Excel
    if (req.files?.excel) {
      const workbook = XLSX.read(req.files.excel.data, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      const excelNumbers = data
        .map((row) => String(row[Object.keys(row)[0]] || "").trim())
        .filter((val) => /^\d+$/.test(val));
      numbers = numbers.concat(excelNumbers);
    }

    // Clean + normalize numbers
    numbers = [...new Set(
      numbers
        .map((n) => n.replace(/\D/g, ""))
        .filter((n) => n.length >= 10)
        .map((n) => (n.startsWith("91") ? `+${n}` : `+91${n.slice(-10)}`))
    )];

    if (!numbers.length) {
      return res.status(400).json({ error: "No valid numbers found." });
    }

    // Message with footer
    let message = req.body.message || "";
    message += `

🟩 *📞 CALL US 9723625050*  
🟩 🌐 *VISIT NOW* https://www.promiseacademy.co.in/`;

    const mediaFile = req.files?.media || null;
console.log(mediaFile)
    if (!message.trim() && !mediaFile) {
      return res.status(400).json({ error: "Message or media is required." });
    }

    const delay = Math.max(parseInt(req.body.delay) || 2000, 1500);
    let sentCount = 0,
      skippedCount = 0,
      failedCount = 0;

    (async () => {
      const total = numbers.length;
      for (let i = 0; i < total; i++) {
        const chatId = numbers[i].replace("+", "") + "@c.us";
        try {
          const isRegistered = await client.isRegisteredUser(chatId);
          if (!isRegistered) {
            skippedCount++;
            io.emit("status", `⚠️ Skipped ${numbers[i]}`);
            continue;
          }

          if (mediaFile) {
            const media = new MessageMedia(
              mediaFile.mimetype,
              mediaFile.data.toString("base64"),
              mediaFile.name
            );
            await client.sendMessage(chatId, media, { caption: message });
          } else {
            await client.sendMessage(chatId, message);
          }

          sentCount++;
          io.emit("status", `✅ (${i + 1}/${total}) Sent to ${numbers[i]}`);
        } catch (err) {
          console.log(err)
          failedCount++;
          io.emit(
            "status",
            `❌ (${i + 1}/${total}) Failed to send to ${numbers[i]}: ${err.message}`
          );
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
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

client.initialize();

server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
