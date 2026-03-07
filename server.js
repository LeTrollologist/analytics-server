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

// Enhanced Schema with Browser and Coordinates
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

    // Device Parse
    if (/mobile/i.test(ua)) device = "Mobile Unit";
    else if (/tablet/i.test(ua)) device = "Tablet Unit";
    
    // OS Parse
    if (/Windows/i.test(ua)) platform = "Windows Core";
    else if (/iPhone|iPad|iPod/i.test(ua)) platform = "iOS Node";
    else if (/Android/i.test(ua)) platform = "Android Mesh";
    else if (/Macintosh|Mac OS/i.test(ua)) platform = "MacOS Kernel";
    else if (/Linux/i.test(ua)) platform = "Linux System";

    // Browser Parse
    if (/Edg/i.test(ua)) browser = "Edge";
    else if (/OPR|Opera/i.test(ua)) browser = "Opera";
    else if (/Chrome/i.test(ua)) browser = "Chrome";
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
    else if (/Firefox/i.test(ua)) browser = "Firefox";

    return { device, platform, browser };
}

// ---------------------------------------------------------
// 1. INGESTION ROUTE (Receives Data from GitHub Pages)
// ---------------------------------------------------------
app.post('/log', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const cleanIp = ip.split(',')[0].trim();
        
        let geo = {};
        // Safety bypass for local development IPs
        const isLocal = cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.');
        
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
// 2. API TELEMETRY ROUTE (Feeds the Admin Dashboard)
// ---------------------------------------------------------
app.get('/api/telemetry', async (req, res) => {
    const secret = process.env.ADMIN_PW || "admin123";
    if (req.query.pw !== secret) return res.status(401).json({ error: "ACCESS DENIED" });

    try {
        // Build Dynamic Filters based on Search & Dropdowns
        const match = {};
        if (req.query.search) {
            const regex = new RegExp(req.query.search, 'i');
            match.$or = [{ ip: regex }, { isp: regex }, { city: regex }, { country: regex }];
        }
        if (req.query.device && req.query.device !== 'ALL') match.device = req.query.device;
        if (req.query.platform && req.query.platform !== 'ALL') match.platform = req.query.platform;
        if (req.query.browser && req.query.browser !== 'ALL') match.browser = req.query.browser;

        // Fetch Logs
        const logs = await Log.find(match).sort({ timestamp: -1 }).limit(100);
        
        // Advanced Aggregations using the active filters with $ifNull fallbacks for old documents
        const totalHits = await Log.countDocuments(match);
        const uniqueIPs = await Log.distinct('ip', match).then(ips => ips.length);
        
        const devices = await Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$device", "Unknown"] }, count: { $sum: 1 } } }]);
        const platforms = await Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$platform", "Unknown"] }, count: { $sum: 1 } } }]);
        const browsers = await Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ["$browser", "Unknown"] }, count: { $sum: 1 } } }]);
        const locations = await Log.aggregate([{ $match: match }, { $group: { _id: { city: "$city", country: "$country" }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]);
        
        // Timeline Data (Last 7 Days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const timelineMatch = { ...match, timestamp: { $gte: sevenDaysAgo } };
        
        const timeline = await Log.aggregate([
            { $match: timelineMatch },
            { $group: { 
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, 
                count: { $sum: 1 } 
            }},
            { $sort: { "_id": 1 } }
        ]);

        res.json({ logs, stats: { totalHits, uniqueIPs, devices, platforms, browsers, locations, timeline } });
    } catch (err) { res.status(500).json({ error: "SYSTEM CRASH" }); }
});

// ---------------------------------------------------------
// 3. SYSTEM HEALTH & STATUS RUNTIME
// ---------------------------------------------------------
app.get('/api/health', async (req, res) => {
    // 1. Analytics & Database Status
    const status = {
        analytics: 'ONLINE', 
        database: mongoose.connection.readyState === 1 ? 'ONLINE' : 'OFFLINE',
        mainSite: 'OFFLINE',
        checkIns: 'OFFLINE'
    };

    // 2. Ping Main Site (GitHub Pages)
    try {
        await axios.get('https://letrollologist.github.io/anya.github.io/index.html', { timeout: 5000 });
        status.mainSite = 'ONLINE';
    } catch (e) {
        status.mainSite = 'OFFLINE';
    }

    // 3. Ping Check-ins Server (Ngrok)
    try {
        const ngrokUrl = 'https://overdefensively-unabjective-eilene.ngrok-free.dev/';
        await axios.head(ngrokUrl, { timeout: 5000 });
        status.checkIns = 'ONLINE';
    } catch (e) {
        status.checkIns = 'OFFLINE';
    }

    res.json(status);
});

// ---------------------------------------------------------
// 4. ADMIN DASHBOARD ROUTE (Serves the UI)
// ---------------------------------------------------------
app.get('/admin', (req, res) => {
    const secret = process.env.ADMIN_PW || "admin123";
    if (req.query.pw !== secret) return res.status(401).send("ACCESS DENIED");

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>SENTINEL // COMMAND_CENTER</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/vue@3/dist/vue.global.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=JetBrains+Mono:wght@300;500;700&display=swap" rel="stylesheet">
    <style>
        :root { --neon-cyan: #00f3ff; --neon-pink: #ff00ff; --deep-bg: #030305; --dark-glass: rgba(10, 15, 20, 0.85); }
        body { background: var(--deep-bg); color: #fff; font-family: 'JetBrains Mono', monospace; overflow-x: hidden; margin: 0; }
        h1, h2, h3 { font-family: 'Orbitron', sans-serif; letter-spacing: 2px; }
        
        .cyber-border { border: 1px solid rgba(0, 243, 255, 0.3); background: var(--dark-glass); backdrop-filter: blur(10px); position: relative; }
        .cyber-border::after { content: ''; position: absolute; top: -1px; left: -1px; width: 10px; height: 10px; border-top: 2px solid var(--neon-cyan); border-left: 2px solid var(--neon-cyan); }
        .cyber-border::before { content: ''; position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px; border-bottom: 2px solid var(--neon-pink); border-right: 2px solid var(--neon-pink); }
        
        .glow-text { text-shadow: 0 0 10px var(--neon-cyan); }
        .glow-pink { text-shadow: 0 0 10px var(--neon-pink); color: var(--neon-pink); }
        
        .scanline { position: fixed; inset: 0; background: linear-gradient(to bottom, transparent 50%, rgba(0, 243, 255, 0.02) 50%); background-size: 100% 4px; pointer-events: none; z-index: 999; }
        .grid-bg { position: fixed; inset: 0; background-image: linear-gradient(rgba(0, 243, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 243, 255, 0.05) 1px, transparent 1px); background-size: 40px 40px; z-index: -1; }
        
        input, select { background: rgba(0, 243, 255, 0.05); border: 1px solid var(--neon-cyan); color: var(--neon-cyan); padding: 8px 12px; font-family: 'JetBrains Mono'; outline: none; transition: 0.3s; }
        input:focus, select:focus { box-shadow: 0 0 15px rgba(0, 243, 255, 0.4); }
        input::placeholder { color: rgba(0, 243, 255, 0.3); }
        
        .btn-cyber { background: transparent; border: 1px solid var(--neon-pink); color: var(--neon-pink); padding: 8px 16px; cursor: pointer; text-transform: uppercase; font-weight: bold; transition: 0.3s; }
        .btn-cyber:hover, .btn-cyber.active { background: rgba(255, 0, 255, 0.2); box-shadow: 0 0 15px rgba(255, 0, 255, 0.5); }
        
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(5px); z-index: 1000; display: flex; justify-content: center; align-items: center; }
        .modal-content { width: 90%; max-width: 700px; }
        
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: var(--deep-bg); }
        ::-webkit-scrollbar-thumb { background: var(--neon-cyan); }
        
        .blink { animation: blinker 1s linear infinite; }
        @keyframes blinker { 50% { opacity: 0; } }
    </style>
</head>
<body>
    <div class="scanline"></div>
    <div class="grid-bg"></div>

    <div id="app" class="p-4 md:p-8 max-w-[1800px] mx-auto min-h-screen flex flex-col">
        <!-- HEADER -->
        <header class="flex flex-col md:flex-row justify-between items-end border-b border-cyan-500/50 pb-4 mb-6">
            <div>
                <div class="flex items-center gap-4 mb-2">
                    <div class="text-[10px] text-cyan-400 opacity-70 uppercase font-bold tracking-widest">Orbital Monitoring Station // V2.0</div>
                    
                    <!-- HEALTH MATRIX LIVE STATUS -->
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

        <!-- CONTROL MATRIX (FILTERS) -->
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

        <!-- DATAVIZ GRID -->
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

        <!-- LIVE DATA FEED -->
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
                                <span class="text-pink-400">{{ log.platform || 'Unknown' }}</span> <span class="text-gray-600">|</span> <span class="text-gray-400">{{ log.device || 'Unknown' }}</span>
                            </td>
                            <td class="p-3 text-yellow-200/70">{{ log.browser || 'Unknown' }}</td>
                            <td class="p-3 text-cyan-300 italic">{{ log.page }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- DEEP SCAN MODAL -->
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

    <script>
        const { createApp } = Vue;
        // The PW is automatically injected from the URL query string
        const API_PW = new URLSearchParams(window.location.search).get('pw');

        createApp({
            data() {
                return {
                    logs:[],
                    stats: { totalHits: 0, uniqueIPs: 0, devices: [], platforms:[], browsers:[], locations: [], timeline:[] },
                    filters: { search: '', device: 'ALL', platform: 'ALL', browser: 'ALL' },
                    health: { database: 'SCANNING', mainSite: 'SCANNING', checkIns: 'SCANNING' },
                    isLive: true,
                    loading: false,
                    pollInterval: null,
                    healthInterval: null,
                    selectedLog: null,
                    charts: {}
                }
            },
            methods: {
                async fetchHealth() {
                    try {
                        const res = await fetch('/api/health');
                        if(res.ok) this.health = await res.json();
                    } catch (e) {
                        this.health = { database: 'OFFLINE', mainSite: 'OFFLINE', checkIns: 'OFFLINE' };
                    }
                },
                async fetchData() {
                    this.loading = true;
                    try {
                        const params = new URLSearchParams({ pw: API_PW, ...this.filters });
                        const res = await fetch('/api/telemetry?' + params.toString());
                        const data = await res.json();
                        if(data.error) { alert(data.error); return; }
                        
                        this.logs = data.logs;
                        this.stats = data.stats;
                        this.updateCharts();
                    } catch (e) {
                        console.error("Uplink failed");
                    }
                    this.loading = false;
                },
                debouncedFetch() {
                    clearTimeout(this.timeout);
                    this.timeout = setTimeout(() => { this.fetchData(); }, 500);
                },
                resetFilters() {
                    this.filters = { search: '', device: 'ALL', platform: 'ALL', browser: 'ALL' };
                    this.fetchData();
                },
                exportCSV() {
                    if (this.logs.length === 0) return;
                    const headers =['Time', 'Target_IP', 'City', 'Country', 'ISP', 'Hardware', 'OS', 'Browser', 'Page'];
                    const rows = this.logs.map(l =>[
                        new Date(l.timestamp).toISOString(),
                        l.ip, l.city, l.country, l.isp, l.device, l.platform, l.browser, l.page
                    ].map(v => \`"\${(v||'').toString().replace(/"/g, '""')}"\`).join(','));
                    
                    const csvContent =[headers.join(','), ...rows].join('\\n');
                    const blob = new Blob([csvContent], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = \`sentinel_intercepts_\${new Date().getTime()}.csv\`;
                    a.click();
                    URL.revokeObjectURL(url);
                },
                toggleLive() {
                    this.isLive = !this.isLive;
                    if (this.isLive) this.startPolling();
                    else clearInterval(this.pollInterval);
                },
                startPolling() {
                    clearInterval(this.pollInterval);
                    this.pollInterval = setInterval(() => { if (!this.loading) this.fetchData(); }, 5000);
                },
                openDeepScan(log) {
                    this.selectedLog = log;
                },
                formatDate(dateStr) {
                    const d = new Date(dateStr);
                    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour12:false});
                },
                initCharts() {
                    Chart.defaults.color = '#666';
                    Chart.defaults.font.family = "'JetBrains Mono', monospace";
                    
                    const tlCtx = document.getElementById('timelineChart').getContext('2d');
                    this.charts.timeline = new Chart(tlCtx, {
                        type: 'line',
                        data: { labels: [], datasets: [{ label: 'Signals', data: [], borderColor: '#00f3ff', backgroundColor: 'rgba(0, 243, 255, 0.1)', borderWidth: 2, fill: true, tension: 0.3 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }, x: { grid: { display: false } } } }
                    });

                    const devCtx = document.getElementById('deviceChart').getContext('2d');
                    this.charts.device = new Chart(devCtx, {
                        type: 'doughnut',
                        data: { labels: [], datasets: [{ data: [], backgroundColor:['#ff00ff', '#00f3ff', '#3b82f6'], borderWidth: 0 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }
                    });

                    const platCtx = document.getElementById('platformChart').getContext('2d');
                    this.charts.platform = new Chart(platCtx, {
                        type: 'doughnut',
                        data: { labels: [], datasets: [{ data: [], backgroundColor:['#00f3ff', '#ff00ff', '#8b5cf6', '#10b981', '#f59e0b'], borderWidth: 0 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }
                    });
                    
                    const broCtx = document.getElementById('browserChart').getContext('2d');
                    this.charts.browser = new Chart(broCtx, {
                        type: 'doughnut',
                        data: { labels: [], datasets: [{ data: [], backgroundColor:['#fcd34d', '#f43f5e', '#3b82f6', '#10b981', '#a855f7', '#64748b'], borderWidth: 0 }] },
                        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }
                    });
                },
                updateCharts() {
                    if(!this.charts.timeline) return;
                    
                    // Timeline
                    this.charts.timeline.data.labels = this.stats.timeline.map(t => t._id.substring(5)); // Show MM-DD
                    this.charts.timeline.data.datasets[0].data = this.stats.timeline.map(t => t.count);
                    this.charts.timeline.update();

                    // Devices
                    this.charts.device.data.labels = this.stats.devices.map(d => d._id);
                    this.charts.device.data.datasets[0].data = this.stats.devices.map(d => d.count);
                    this.charts.device.update();

                    // Platforms
                    this.charts.platform.data.labels = this.stats.platforms.map(p => p._id);
                    this.charts.platform.data.datasets[0].data = this.stats.platforms.map(p => p.count);
                    this.charts.platform.update();
                    
                    // Browsers
                    this.charts.browser.data.labels = this.stats.browsers.map(b => b._id);
                    this.charts.browser.data.datasets[0].data = this.stats.browsers.map(b => b.count);
                    this.charts.browser.update();
                }
            },
            mounted() {
                this.initCharts();
                this.fetchHealth();
                this.fetchData();
                this.startPolling();
                this.healthInterval = setInterval(() => this.fetchHealth(), 30000); // Check health every 30s
            },
            unmounted() {
                clearInterval(this.pollInterval);
                clearInterval(this.healthInterval);
            }
        }).mount('#app');
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('SENTINEL ONLINE - Port:', PORT));
