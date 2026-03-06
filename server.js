const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// --- DATABASE SETUP ---
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err.message));

const LogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    ip: String,
    geo: Object,
    userAgent: String,
    page: String
});
const Log = mongoose.model('Log', LogSchema);

// --- LOGGING ENDPOINT ---
app.post('/log', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const cleanIp = ip.split(',')[0];
        
        // Fetch Geo Data
        const geoResponse = await axios.get(`http://ip-api.com/json/${cleanIp}`).catch(() => ({ data: {} }));
        const geoData = geoResponse.data;

        const newLog = new Log({
            ip: cleanIp,
            geo: geoData,
            userAgent: req.body.ua || "Unknown",
            page: req.body.page || "Home"
        });

        await newLog.save();
        res.status(200).send("Logged");
    } catch (err) {
        console.error("Logging Error:", err.message);
        res.status(500).send("Error");
    }
});

// --- ADMIN DASHBOARD ---
app.get('/admin', async (req, res) => {
    // Uses the ADMIN_PW from Render Environment Variables
    const secret = process.env.ADMIN_PW || "fallback_password";
    
    if (req.query.pw !== secret) {
        return res.status(401).send("<h1>Unauthorized</h1>");
    }

    try {
        const logs = await Log.find().sort({ timestamp: -1 }).limit(100);

        let rows = logs.map(log => `
            <tr>
                <td>${new Date(log.timestamp).toLocaleString()}</td>
                <td>${log.ip}</td>
                <td>${log.geo?.city || 'Unknown'}, ${log.geo?.country || 'Unknown'}</td>
                <td>${log.geo?.isp || 'Unknown'}</td>
                <td style="font-size: 11px; color: #ccc;">${log.userAgent}</td>
            </tr>
        `).join('');

        res.send(`
            <html>
            <head>
                <title>Admin Console</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #0f0f0f; color: white; padding: 40px; }
                    h1 { color: #ff69b4; text-shadow: 0 0 10px rgba(255,105,180,0.3); }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; background: #1a1a1a; }
                    th, td { border: 1px solid #333; padding: 12px; text-align: left; }
                    th { background: #ff69b4; color: white; text-transform: uppercase; font-size: 12px; }
                    tr:nth-child(even) { background: #252525; }
                    tr:hover { background: #333; }
                </style>
            </head>
            <body>
                <h1>Anya Site Analytics</h1>
                <p>Total Visits Logged: ${logs.length}</p>
                <table>
                    <tr>
                        <th>Time</th><th>IP Address</th><th>Location</th><th>ISP</th><th>User Agent</th>
                    </tr>
                    ${rows}
                </table>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Error loading logs.");
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
