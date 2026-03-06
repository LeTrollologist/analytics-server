const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// --- DATABASE SETUP ---
// Replace with your MongoDB Atlas Connection String
const MONGO_URI = process.env.MONGO_URI || "your_mongodb_connection_string";
mongoose.connect(MONGO_URI).then(() => console.log("Connected to DB"));

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
        // Get IP from Render's headers
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        // Get Geolocation using a free API (ip-api.com)
        const geoResponse = await axios.get(`http://ip-api.com/json/${ip.split(',')[0]}`);
        const geoData = geoResponse.data;

        const newLog = new Log({
            ip: ip.split(',')[0],
            geo: geoData,
            userAgent: req.body.ua,
            page: req.body.page
        });

        await newLog.save();
        res.status(200).send("Logged");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

// --- ADMIN DASHBOARD ---
app.get('/admin', async (req, res) => {
    // Basic Password protection via Query String (e.g., /admin?pw=yourpassword)
    if (req.query.pw !== "your_admin_password") {
        return res.status(401).send("Unauthorized");
    }

    const logs = await Log.find().sort({ timestamp: -1 });

    let rows = logs.map(log => `
        <tr>
            <td>${new Date(log.timestamp).toLocaleString()}</td>
            <td>${log.ip}</td>
            <td>${log.geo.city}, ${log.geo.country}</td>
            <td>${log.geo.isp}</td>
            <td>${log.userAgent}</td>
        </tr>
    `).join('');

    res.send(`
        <html>
        <head>
            <title>Admin Console</title>
            <style>
                body { font-family: sans-serif; background: #121212; color: white; padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #333; padding: 12px; text-align: left; }
                th { background: #ff69b4; color: white; }
                tr:nth-child(even) { background: #1e1e1e; }
            </style>
        </head>
        <body>
            <h1>Visitor Analytics</h1>
            <table>
                <tr>
                    <th>Time</th><th>IP</th><th>Location</th><th>ISP</th><th>UserAgent</th>
                </tr>
                ${rows}
            </table>
        </body>
        </html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
