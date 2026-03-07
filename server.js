const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // Allow all origins so GitHub Pages can POST to /log

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
    lat: Number,
    lon: Number,
    ua: String,
    device: String,
    platform: String,
    browser: String,
    page: String,
    screen: String
});
const Log = mongoose.model('Log', LogSchema);

function parseUA(ua) {
    let device = "Desktop Station";
    let platform = "Unknown OS";
    let browser = "Unknown Browser";

    if (!ua) return { device, platform, browser };

    if (/mobile/i.test(ua)) device = "Mobile Unit";
    else if (/tablet/i.test(ua)) device = "Tablet Unit";

    if (/Windows/i.test(ua)) platform = "Windows Core";
    else if (/iPhone|iPad|iPod/i.test(ua)) platform = "iOS Node";
    else if (/Android/i.test(ua)) platform = "Android Mesh";
    else if (/Macintosh|Mac OS/i.test(ua)) platform = "MacOS Kernel";
    else if (/Linux/i.test(ua)) platform = "Linux System";

    if (/Edg/i.test(ua)) browser = "Edge";
    else if (/OPR|Opera/i.test(ua)) browser = "Opera";
    else if (/Chrome/i.test(ua)) browser = "Chrome";
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
    else if (/Firefox/i.test(ua)) browser = "Firefox";

    return { device, platform, browser };
}

// ---------------------------------------------------------
// 1. INGESTION ROUTE — receives data from GitHub Pages
//    URL: POST https://analytics-server-bdrm.onrender.com/log
// ---------------------------------------------------------
app.post('/log', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const cleanIp = ip.split(',')[0].trim();

        const isLocal = cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.');

        let geo = {};
        if (!isLocal) {
            const geoResponse = await axios.get(`http://ip-api.com/json/${cleanIp}`).catch(() => ({ data: {} }));
            geo = geoResponse.data;
        } else {
            geo = { city: "Localhost", regionName: "LAN", country: "Internal Matrix", isp: "Local Network", lat: 0, lon: 0 };
        }

        const uaInfo = parseUA(req.body.ua);

        const newLog = new Log({
            ip: cleanIp,
            city: geo.city || "Void",
            region: geo.regionName || "Void",
            country: geo.country || "Void",
            isp: geo.isp || "Dark Web",
            lat: geo.lat || null,
            lon: geo.lon || null,
            ua: req.body.ua,
            device: uaInfo.device,
            platform: uaInfo.platform,
            browser: uaInfo.browser,
            page: req.body.page || "Root",
            screen: req.body.screen || "Unknown"
        });

        await newLog.save();
        res.status(200).send("DATA INGESTED");
    } catch (err) {
        console.error("Ingestion Error:", err);
        res.status(500).send("NULL");
    }
});

// ---------------------------------------------------------
// 2. TELEMETRY ROUTE — feeds the admin dashboard
//    URL: GET https://analytics-server-bdrm.onrender.com/api/telemetry?pw=...
// ---------------------------------------------------------
app.get('/api/telemetry', async (req, res) => {
    const secret = process.env.ADMIN_PW || "admin123";
    if (req.query.pw !== secret) return res.status(401).json({ error: "ACCESS DENIED" });

    try {
        const match = {};
        if (req.query.search) {
            const regex = new RegExp(req.query.search, 'i');
            match.$or = [{ ip: regex }, { isp: regex }, { city: regex }, { country: regex }];
        }
        if (req.query.device && req.query.device !== 'ALL') match.device = req.query.device;
        if (req.query.platform && req.query.platform !== 'ALL') match.platform = req.query.platform;
        if (req.query.browser && req.query.browser !== 'ALL') match.browser = req.query.browser;

        const logs = await Log.find(match).sort({ timestamp: -1 }).limit(100);
        const totalHits = await Log.countDocuments(match);
        const uniqueIPs = await Log.distinct('ip', match).then(ips => ips.length);

        const devices   = await Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$device",   "Unknown"] }, count: { $sum: 1 } } }]);
        const platforms = await Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$platform", "Unknown"] }, count: { $sum: 1 } } }]);
        const browsers  = await Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$browser",  "Unknown"] }, count: { $sum: 1 } } }]);
        const locations = await Log.aggregate([
            { $match: match },
            { $group: { _id: { city: "$city", country: "$country" }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const timeline = await Log.aggregate([
            { $match: { ...match, timestamp: { $gte: sevenDaysAgo } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, count: { $sum: 1 } } },
            { $sort: { "_id": 1 } }
        ]);

        res.json({ logs, stats: { totalHits, uniqueIPs, devices, platforms, browsers, locations, timeline } });
    } catch (err) {
        console.error("Telemetry Error:", err);
        res.status(500).json({ error: "SYSTEM CRASH" });
    }
});

// ---------------------------------------------------------
// 3. HEALTH ROUTE — status indicators in the dashboard
//    URL: GET https://analytics-server-bdrm.onrender.com/api/health
// ---------------------------------------------------------
app.get('/api/health', async (req, res) => {
    const status = {
        analytics: 'ONLINE',
        database: mongoose.connection.readyState === 1 ? 'ONLINE' : 'OFFLINE',
        mainSite: 'OFFLINE',
        checkIns: 'OFFLINE'
    };

    try {
        await axios.get('https://letrollologist.github.io/anya.github.io/index.html', { timeout: 5000 });
        status.mainSite = 'ONLINE';
    } catch (e) { /* stays OFFLINE */ }

    try {
        await axios.head('https://overdefensively-unabjective-eilene.ngrok-free.dev/', { timeout: 5000 });
        status.checkIns = 'ONLINE';
    } catch (e) { /* stays OFFLINE */ }

    res.json(status);
});

// ---------------------------------------------------------
// 4. ADMIN DASHBOARD — served at /admin?pw=...
//    Loads external assets/app.js and assets/style.css
// ---------------------------------------------------------
app.get('/admin', (req, res) => {
    const secret = process.env.ADMIN_PW || "admin123";
    if (req.query.pw !== secret) return res.status(401).send("ACCESS DENIED");

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SENTINEL // COMMAND_CENTER</title>
    <script>
        const originalWarn = console.warn;
        console.warn = (...args) => { if (typeof args[0] === 'string' && args[0].includes('cdn.tailwindcss.com')) return; originalWarn(...args); };
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=JetBrains+Mono:wght@300;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
    <div class="scanline"></div>
    <div class="grid-bg"></div>

    <div id="app" class="p-4 md:p-8 max-w-[1800px] mx-auto min-h-screen flex flex-col">
        <header class="flex flex-col md:flex-row justify-between items-end border-b border-cyan-500/50 pb-4 mb-6">
            <div>
                <div class="flex items-center gap-4 mb-2">
                    <div class="text-[10px] text-cyan-400 opacity-70 uppercase font-bold tracking-widest">Orbital Monitoring Station // V2.0</div>
                    <div class="flex gap-3 text-[9px] uppercase font-bold border border-white/10 px-2 py-1 bg-black/50">
                        <div>DB: <span :class="health.database === 'ONLINE' ? 'text-green-400' : 'text-red-500 blink'">{{ health.database }}</span></div>
                        <div>SITE: <span :class="health.mainSite === 'ONLINE' ? 'text-green-400' : 'text-red-500 blink'">{{ health.mainSite }}</span></div>
                        <div>NGROK: <span :class="health.checkIns === 'ONLINE' ? 'text-green-400' : 'text-red-500 blink'">{{ health.checkIns }}</span></div>
                    </div>
                </div>
                <h1 class="text-4xl md:text-5xl font-bold glow-text uppercase">Sentinel Core <span class="blink">_</span></h1>
            </div>
            <div class="flex gap-6 mt-4 md:mt-0 text-right">
                <div>
                    <div class="text-[10px] text-gray-500 uppercase">Total Intercepts</div>
                    <div class="text-pink-400 text-xl font-bold glow-pink">{{ stats.totalHits }}</div>
                </div>
                <div>
                    <div class="text-[10px] text-gray-500 uppercase">Unique Targets</div>
                    <div class="text-cyan-400 text-xl font-bold glow-text">{{ stats.uniqueIPs }}</div>
                </div>
                <div>
                    <div class="text-[10px] text-gray-500 uppercase">Live Uplink</div>
                    <button @click="toggleLive" :class="['btn-cyber', isLive ? 'active' : '', 'text-xs px-2 py-1 mt-1']">
                        {{ isLive ? 'ACTIVE' : 'PAUSED' }}
                    </button>
                </div>
            </div>
        </header>

        <div class="cyber-border p-4 mb-6 flex flex-wrap gap-4 items-center">
            <div class="text-cyan-400 font-bold uppercase tracking-widest text-sm mr-4">> FILTER_MATRIX:</div>
            <input v-model="filters.search" @input="debouncedFetch" type="text" placeholder="Search IP, ISP, City..." class="flex-1 min-w-[200px] text-sm">
            <select v-model="filters.device" @change="fetchData" class="text-sm">
                <option value="ALL">ALL HARDWARE</option>
                <option value="Mobile Unit">MOBILE UNITS</option>
                <option value="Desktop Station">DESKTOP STATIONS</option>
            </select>
            <select v-model="filters.platform" @change="fetchData" class="text-sm">
                <option value="ALL">ALL OS NODES</option>
                <option value="iOS Node">iOS NODES</option>
                <option value="Android Mesh">ANDROID MESH</option>
                <option value="Windows Core">WINDOWS CORE</option>
                <option value="MacOS Kernel">MACOS KERNEL</option>
            </select>
            <select v-model="filters.browser" @change="fetchData" class="text-sm">
                <option value="ALL">ALL BROWSERS</option>
                <option value="Chrome">CHROME</option>
                <option value="Safari">SAFARI</option>
                <option value="Firefox">FIREFOX</option>
                <option value="Edge">EDGE</option>
                <option value="Opera">OPERA</option>
            </select>
            <button @click="resetFilters" class="btn-cyber text-sm">RESET</button>
            <button @click="exportCSV" class="btn-cyber text-sm !border-cyan-400 !text-cyan-400 hover:!bg-cyan-500/20">DOWNLOAD CSV</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div class="cyber-border p-4">
                <h3 class="text-xs text-cyan-400 mb-4 uppercase font-bold tracking-widest">Temporal Activity (7D)</h3>
                <div class="h-[150px]"><canvas id="timelineChart"></canvas></div>
            </div>
            <div class="cyber-border p-4 flex flex-col">
                <h3 class="text-xs text-cyan-400 mb-4 uppercase font-bold tracking-widest">Hardware / OS Setup</h3>
                <div class="flex-1 flex justify-center items-center h-[150px]">
                    <div class="w-1/2 h-full"><canvas id="deviceChart"></canvas></div>
                    <div class="w-1/2 h-full"><canvas id="platformChart"></canvas></div>
                </div>
            </div>
            <div class="cyber-border p-4">
                <h3 class="text-xs text-cyan-400 mb-4 uppercase font-bold tracking-widest">Browser Engines</h3>
                <div class="h-[150px]"><canvas id="browserChart"></canvas></div>
            </div>
            <div class="cyber-border p-4">
                <h3 class="text-xs text-pink-500 glow-pink mb-4 uppercase font-bold tracking-widest">Top Sectors</h3>
                <div class="space-y-3">
                    <div v-for="loc in stats.locations" :key="loc._id.city" class="flex justify-between items-center text-xs">
                        <span class="text-gray-300">{{ loc._id.city || 'Unknown' }}, {{ loc._id.country || 'Unknown' }}</span>
                        <div class="flex-1 border-b border-dashed border-cyan-900/50 mx-4"></div>
                        <span class="text-cyan-400 font-bold">{{ loc.count }}</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="cyber-border flex-1 flex flex-col overflow-hidden min-h-[400px]">
            <div class="bg-cyan-500/10 p-3 border-b border-cyan-500/30 flex justify-between items-center">
                <h2 class="text-sm font-bold uppercase tracking-widest text-cyan-400">Intercepted Signal Log (Latest 100)</h2>
                <span v-if="loading" class="text-[10px] text-pink-500 blink uppercase">Processing Query...</span>
            </div>
            <div class="flex-1 overflow-auto">
                <table class="w-full text-left border-collapse whitespace-nowrap">
                    <thead class="sticky top-0 bg-black z-10">
                        <tr class="text-[10px] text-gray-500 uppercase">
                            <th class="p-3 border-b border-white/5">Time_Sync</th>
                            <th class="p-3 border-b border-white/5">Target_IP</th>
                            <th class="p-3 border-b border-white/5">ISP_Routing</th>
                            <th class="p-3 border-b border-white/5">Location</th>
                            <th class="p-3 border-b border-white/5">Hardware</th>
                            <th class="p-3 border-b border-white/5">Browser</th>
                            <th class="p-3 border-b border-white/5">Action_Node</th>
                        </tr>
                    </thead>
                    <tbody class="text-xs font-mono">
                        <tr v-if="logs.length === 0">
                            <td colspan="7" class="p-8 text-center text-gray-500">NO SIGNALS FOUND IN CURRENT MATRIX</td>
                        </tr>
                        <tr v-for="log in logs" :key="log._id" @click="openDeepScan(log)" class="border-b border-white/5 hover:bg-cyan-500/10 transition cursor-pointer group">
                            <td class="p-3 text-gray-400">{{ formatDate(log.timestamp) }}</td>
                            <td class="p-3 text-cyan-400 font-bold group-hover:glow-text transition">{{ log.ip }}</td>
                            <td class="p-3 text-gray-500 truncate max-w-[150px]">{{ log.isp }}</td>
                            <td class="p-3 text-gray-300">{{ log.city }}, {{ log.country }}</td>
                            <td class="p-3">
                                <span class="text-pink-400">{{ log.platform || 'Unknown' }}</span>
                                <span class="text-gray-600"> | </span>
                                <span class="text-gray-400">{{ log.device || 'Unknown' }}</span>
                            </td>
                            <td class="p-3 text-yellow-200/70">{{ log.browser || 'Unknown' }}</td>
                            <td class="p-3 text-cyan-300 italic">{{ log.page }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div v-if="selectedLog" class="modal-overlay" @click.self="selectedLog = null">
            <div class="cyber-border modal-content p-6 shadow-2xl">
                <div class="flex justify-between items-center mb-6 border-b border-pink-500/30 pb-2">
                    <h2 class="text-xl font-bold glow-pink uppercase text-pink-500">> DEEP SCAN RESULTS</h2>
                    <button @click="selectedLog = null" class="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
                </div>
                <div class="grid grid-cols-2 gap-4 text-sm font-mono mb-6">
                    <div><span class="text-gray-500 block text-[10px]">TARGET_IP</span><span class="text-cyan-400 font-bold">{{ selectedLog.ip }}</span></div>
                    <div><span class="text-gray-500 block text-[10px]">TIMESTAMP</span><span class="text-gray-200">{{ formatDate(selectedLog.timestamp) }}</span></div>
                    <div class="col-span-2"><span class="text-gray-500 block text-[10px]">RAW_USER_AGENT</span><span class="text-gray-400 text-[10px] break-all">{{ selectedLog.ua }}</span></div>
                    <div><span class="text-gray-500 block text-[10px]">ISP / ROUTER</span><span class="text-gray-200">{{ selectedLog.isp }}</span></div>
                    <div>
                        <span class="text-gray-500 block text-[10px]">COORDINATES</span>
                        <span class="text-gray-200">
                            {{ selectedLog.city }}, {{ selectedLog.region }}, {{ selectedLog.country }}
                            <a v-if="selectedLog.lat && selectedLog.lon" :href="'https://www.google.com/maps/search/?api=1&query=' + selectedLog.lat + ',' + selectedLog.lon" target="_blank" class="text-pink-400 ml-2 hover:underline text-[10px] blink">[MAP_LINK]</a>
                        </span>
                    </div>
                    <div><span class="text-gray-500 block text-[10px]">HARDWARE_NODE</span><span class="text-pink-400">{{ selectedLog.device || 'Unknown' }}</span></div>
                    <div><span class="text-gray-500 block text-[10px]">OS_KERNEL</span><span class="text-pink-400">{{ selectedLog.platform || 'Unknown' }}</span></div>
                    <div><span class="text-gray-500 block text-[10px]">BROWSER_ENGINE</span><span class="text-yellow-200/70">{{ selectedLog.browser || 'Unknown' }}</span></div>
                    <div><span class="text-gray-500 block text-[10px]">VIEWPORT_RES</span><span class="text-cyan-400">{{ selectedLog.screen }}</span></div>
                    <div class="col-span-2"><span class="text-gray-500 block text-[10px]">ACTIVE_PAGE</span><span class="text-cyan-400">{{ selectedLog.page }}</span></div>
                </div>
                <div class="flex justify-end">
                    <button @click="selectedLog = null" class="btn-cyber">TERMINATE CONNECTION</button>
                </div>
            </div>
        </div>
    </div>

    <script src="/assets/app.js"><\/script>
</body>
</html>`);
});

// Serve static assets (app.js, style.css) from /assets folder
const path = require('path');
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('SENTINEL ONLINE - Port:', PORT));
