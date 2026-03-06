const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("SYSTEM ONLINE: Neural Link Established"))
    .catch(err => console.error("CONNECTION CRITICAL ERROR:", err.message));

const LogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    ip: String,
    city: String,
    region: String,
    country: String,
    isp: String,
    ua: String,
    device: String,
    platform: String,
    page: String,
    screen: String
});
const Log = mongoose.model('Log', LogSchema);

function parseUA(ua) {
    let device = "Neural Terminal";
    let platform = "Unknown OS";
    if (/mobile/i.test(ua)) device = "Mobile Unit";
    else if (/tablet/i.test(ua)) device = "Tablet Unit";
    else device = "Desktop Station";
    
    if (/Windows/i.test(ua)) platform = "Windows Core";
    else if (/iPhone|iPad|iPod/i.test(ua)) platform = "iOS Node";
    else if (/Android/i.test(ua)) platform = "Android Mesh";
    else if (/Macintosh/i.test(ua)) platform = "MacOS Kernel";
    return { device, platform };
}

app.post('/log', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const cleanIp = ip.split(',')[0];
        const geoResponse = await axios.get(`http://ip-api.com/json/${cleanIp}`).catch(() => ({ data: {} }));
        const geo = geoResponse.data;
        const uaInfo = parseUA(req.body.ua);

        const newLog = new Log({
            ip: cleanIp,
            city: geo.city || "Void",
            region: geo.regionName || "Void",
            country: geo.country || "Void",
            isp: geo.isp || "Dark Web",
            ua: req.body.ua,
            device: uaInfo.device,
            platform: uaInfo.platform,
            page: req.body.page || "Root",
            screen: req.body.screen || "Unknown"
        });

        await newLog.save();
        res.status(200).send("DATA INGESTED");
    } catch (err) { res.status(500).send("NULL"); }
});

app.get('/admin', async (req, res) => {
    const secret = process.env.ADMIN_PW || "admin123";
    if (req.query.pw !== secret) return res.status(401).send("ACCESS DENIED");

    try {
        const totalLogs = await Log.countDocuments();
        const logs = await Log.find().sort({ timestamp: -1 }).limit(50);
        const countries = await Log.aggregate([{ $group: { _id: "$country", count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
        const devices = await Log.aggregate([{ $group: { _id: "$device", count: { $sum: 1 } } }]);

        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SENTINEL // ANYA_MONITOR</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=JetBrains+Mono:wght@300;500&display=swap" rel="stylesheet">
    <style>
        :root { --neon-cyan: #00f3ff; --neon-pink: #ff00ff; --deep-bg: #030305; }
        body { background: var(--deep-bg); color: #fff; font-family: 'JetBrains Mono', monospace; overflow-x: hidden; }
        h1, h2, h3 { font-family: 'Orbitron', sans-serif; letter-spacing: 2px; }
        .cyber-border { border: 1px solid var(--neon-cyan); box-shadow: 0 0 15px rgba(0, 243, 255, 0.2); position: relative; }
        .cyber-border::after { content: ''; position: absolute; top: 0; left: 0; width: 10px; height: 10px; background: var(--neon-cyan); }
        .glow-text { text-shadow: 0 0 10px var(--neon-cyan); }
        .glow-pink { text-shadow: 0 0 10px var(--neon-pink); color: var(--neon-pink); }
        .scanline { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(to bottom, transparent 50%, rgba(0, 243, 255, 0.02) 50%); background-size: 100% 4px; pointer-events: none; z-index: 999; }
        .grid-bg { position: fixed; inset: 0; background-image: linear-gradient(rgba(0, 243, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 243, 255, 0.05) 1px, transparent 1px); background-size: 50px 50px; z-index: -1; }
        .stats-card { background: rgba(0, 0, 0, 0.8); transition: 0.3s; cursor: pointer; }
        .stats-card:hover { border-color: var(--neon-pink); transform: translateY(-5px); box-shadow: 0 0 20px rgba(255, 0, 255, 0.3); }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: var(--neon-cyan); }
    </style>
</head>
<body class="p-4">
    <div class="scanline"></div>
    <div class="grid-bg"></div>

    <div class="max-w-[1600px] mx-auto">
        <!-- TOP HUD -->
        <header class="flex flex-col md:flex-row justify-between items-end border-b-2 border-cyan-500 pb-4 mb-8">
            <div>
                <div class="text-[10px] text-cyan-400 opacity-70 uppercase mb-1 font-bold">Orbital Monitoring Station // Sentinel-1</div>
                <h1 class="text-4xl font-bold glow-text uppercase">Anya Tracking Node <span class="animate-pulse">_</span></h1>
            </div>
            <div class="flex gap-8 mt-4 md:mt-0">
                <div class="text-right">
                    <div class="text-[10px] text-gray-500 uppercase">System Status</div>
                    <div class="text-green-400 text-sm font-bold glow-text">OPERATIONAL</div>
                </div>
                <div class="text-right">
                    <div class="text-[10px] text-gray-500 uppercase">Neural Load</div>
                    <div class="text-cyan-400 text-sm font-bold glow-text">${(totalLogs * 0.12).toFixed(2)}%</div>
                </div>
            </div>
        </header>

        <!-- DATA PANELS -->
        <div class="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
            <div class="lg:col-span-1 stats-card cyber-border p-6 rounded-bl-3xl">
                <h3 class="text-xs text-cyan-400 mb-6 uppercase tracking-widest font-bold">Geospatial Distribution</h3>
                <div class="space-y-4">
                    ${countries.map(c => `
                        <div class="flex justify-between items-center text-xs">
                            <span class="opacity-70">${c._id}</span>
                            <div class="flex-1 border-b border-dashed border-cyan-900 mx-2"></div>
                            <span class="text-cyan-400 font-bold">${c.count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="lg:col-span-2 stats-card cyber-border p-6">
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-xs text-cyan-400 uppercase tracking-widest font-bold">Neural Traffic Breakdown</h3>
                    <div class="flex gap-4 text-[10px]">
                        <span class="flex items-center"><span class="w-2 h-2 bg-pink-500 mr-2"></span>Device</span>
                        <span class="flex items-center"><span class="w-2 h-2 bg-cyan-500 mr-2"></span>Node</span>
                    </div>
                </div>
                <div class="h-[250px]">
                    <canvas id="mainChart"></canvas>
                </div>
            </div>

            <div class="lg:col-span-1 stats-card cyber-border p-6 rounded-tr-3xl">
                <h3 class="text-xs text-pink-500 mb-6 uppercase tracking-widest font-bold glow-pink">Active Protocols</h3>
                <div class="text-[10px] space-y-4 font-mono">
                    <div class="flex items-center text-green-500">
                        <span class="w-1 h-1 bg-green-500 mr-2 animate-ping"></span> IP_TRIANGULATION: ACTIVE
                    </div>
                    <div class="flex items-center text-green-500">
                        <span class="w-1 h-1 bg-green-500 mr-2 animate-ping"></span> DEVICE_FINGERPRINT: ACTIVE
                    </div>
                    <div class="flex items-center text-cyan-500">
                        <span class="w-1 h-1 bg-cyan-500 mr-2"></span> DB_LATENCY: 14ms
                    </div>
                    <div class="mt-8 pt-8 border-t border-white/10 italic text-gray-500">
                        "The system watches. Every link, every heartbeat, logged into eternity."
                    </div>
                </div>
            </div>
        </div>

        <!-- MAIN DATA FEED -->
        <div class="cyber-border stats-card rounded-lg overflow-hidden">
            <div class="bg-cyan-500/10 p-4 border-b border-cyan-500/30 flex justify-between items-center">
                <h2 class="text-sm font-bold uppercase tracking-widest text-cyan-400">Intercepted Signal Log</h2>
                <span class="text-[10px] text-cyan-500 animate-pulse">STREAMING LIVE DATA...</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="text-[10px] text-gray-500 uppercase bg-black">
                            <th class="p-4 border-b border-white/5">Signal_ID</th>
                            <th class="p-4 border-b border-white/5">Network_Identity</th>
                            <th class="p-4 border-b border-white/5">Coord_Location</th>
                            <th class="p-4 border-b border-white/5">Machine_Specs</th>
                            <th class="p-4 border-b border-white/5">Access_Point</th>
                        </tr>
                    </thead>
                    <tbody class="text-xs">
                        ${logs.map((l, i) => `
                            <tr class="border-b border-white/5 hover:bg-cyan-500/5 transition group">
                                <td class="p-4 text-gray-500 font-mono">SIG_${logs.length - i}</td>
                                <td class="p-4">
                                    <div class="text-cyan-400 font-bold glow-text mb-1">${l.ip}</div>
                                    <div class="text-[9px] text-gray-500 uppercase">${l.isp}</div>
                                </td>
                                <td class="p-4">
                                    <span class="text-white">${l.city}</span><br>
                                    <span class="text-[9px] text-gray-500">${l.country}</span>
                                </td>
                                <td class="p-4">
                                    <span class="px-2 py-0.5 border border-pink-500/50 text-pink-500 rounded text-[9px] font-bold mr-1 uppercase">${l.platform}</span>
                                    <span class="text-[9px] text-gray-400 uppercase">${l.device}</span>
                                </td>
                                <td class="p-4 text-cyan-300 font-bold italic tracking-wider">${l.page}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        const ctx = document.getElementById('mainChart').getContext('2d');
        const deviceLabels = ${JSON.stringify(devices.map(d => d._id))};
        const deviceData = ${JSON.stringify(devices.map(d => d.count))};

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: deviceLabels,
                datasets: [{
                    label: 'Device Distribution',
                    data: deviceData,
                    borderColor: '#00f3ff',
                    backgroundColor: 'rgba(0, 243, 255, 0.1)',
                    borderWidth: 2,
                    pointBackgroundColor: '#ff00ff',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#666' } },
                    x: { grid: { display: false }, ticks: { color: '#666' } }
                },
                plugins: { legend: { display: false } }
            }
        });
    </script>
</body>
</html>
        `);
    } catch (err) { res.status(500).send("SYSTEM CRASH"); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('SENTINEL ONLINE'));
