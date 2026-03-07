const express  = require('express');
const axios    = require('axios');
const mongoose = require('mongoose');
const cors     = require('cors');
const rateLimit = require('express-rate-limit');
const path     = require('path');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

// ── CORS: only GitHub Pages may POST to /log ─────────────────────────────────
const logCors = cors({ origin: 'https://letrollologist.github.io' });

// ── Rate limiters ─────────────────────────────────────────────────────────────
const logLimiter = rateLimit({
    windowMs: 60 * 1000, max: 10,
    standardHeaders: true, legacyHeaders: false, message: 'RATE LIMITED'
});
const adminLimiter = rateLimit({
    windowMs: 60 * 1000, max: 60,
    standardHeaders: true, legacyHeaders: false, message: 'RATE LIMITED'
});

// ── Database ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('SYSTEM ONLINE: Neural Link Established'))
    .catch(err => console.error('DB ERROR:', err.message));

const LogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    ip:        { type: String, index: true },
    city: String, region: String, country: String, isp: String,
    lat: Number,  lon: Number,
    ua: String,   device: String, platform: String, browser: String,
    page: String, screen: String,
    referrer: String,
    sessionId: String,
    flags: { type: [String], default: [] }   // e.g. ['bot', 'vpn']
});
const Log = mongoose.model('Log', LogSchema);

// Blocklist — IPs that should be silently dropped from /log
const BlockSchema = new mongoose.Schema({
    ip:        { type: String, unique: true },
    reason:    String,
    createdAt: { type: Date, default: Date.now }
});
const Block = mongoose.model('Block', BlockSchema);

// ── UA parser ─────────────────────────────────────────────────────────────────
function parseUA(ua) {
    let device = 'Desktop Station', platform = 'Unknown OS', browser = 'Unknown Browser';
    if (!ua) return { device, platform, browser };
    if (/mobile/i.test(ua))  device = 'Mobile Unit';
    else if (/tablet/i.test(ua)) device = 'Tablet Unit';
    if      (/Windows/i.test(ua))            platform = 'Windows Core';
    else if (/iPhone|iPad|iPod/i.test(ua))   platform = 'iOS Node';
    else if (/Android/i.test(ua))            platform = 'Android Mesh';
    else if (/Macintosh|Mac OS/i.test(ua))   platform = 'MacOS Kernel';
    else if (/Linux/i.test(ua))              platform = 'Linux System';
    if      (/Edg/i.test(ua))               browser = 'Edge';
    else if (/OPR|Opera/i.test(ua))         browser = 'Opera';
    else if (/Chrome/i.test(ua))            browser = 'Chrome';
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/Firefox/i.test(ua))           browser = 'Firefox';
    return { device, platform, browser };
}

// Simple bot detection heuristic
function detectFlags(ua, ip) {
    const flags = [];
    if (!ua || /bot|crawl|spider|slurp|curl|wget|python|java|go-http/i.test(ua)) flags.push('bot');
    return flags;
}

// Auth middleware
function requireAuth(req, res, next) {
    const secret = process.env.ADMIN_PW;
    if (!secret) return res.status(500).json({ error: 'SERVER MISCONFIGURED' });
    if (req.query.pw !== secret) return res.status(401).json({ error: 'ACCESS DENIED' });
    next();
}

// ── Keep-alive self-ping (prevents Render free tier spin-down) ─────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/api/health`
    : null;
if (SELF_URL) {
    setInterval(async () => {
        try { await axios.get(SELF_URL, { timeout: 10000 }); console.log('[KEEP-ALIVE] OK'); }
        catch (e) { console.warn('[KEEP-ALIVE] Failed:', e.message); }
    }, 14 * 60 * 1000);
}

// =============================================================================
// ROUTE 1 — Ingest visitor hit
// POST /log
// =============================================================================
app.post('/log', logCors, logLimiter, async (req, res) => {
    try {
        const raw   = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const cleanIp = raw.split(',')[0].trim();
        const isLocal = ['127.0.0.1','::1'].includes(cleanIp)
            || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.');

        // Drop blocked IPs silently
        const blocked = await Block.findOne({ ip: cleanIp });
        if (blocked) return res.status(200).send('OK');

        let geo = {};
        if (!isLocal) {
            const g = await axios.get(`http://ip-api.com/json/${cleanIp}?fields=status,city,regionName,country,isp,lat,lon,proxy,hosting`, { timeout: 4000 }).catch(() => ({ data: {} }));
            geo = g.data || {};
        } else {
            geo = { city: 'Localhost', regionName: 'LAN', country: 'Internal', isp: 'Local', lat: 0, lon: 0 };
        }

        const ua    = (req.body.ua || '').slice(0, 500);
        const uaInfo = parseUA(ua);
        const flags  = detectFlags(ua, cleanIp);
        if (geo.proxy || geo.hosting) flags.push('vpn/proxy');

        await Log.create({
            ip: cleanIp,
            city:    geo.city       || 'Void',
            region:  geo.regionName || 'Void',
            country: geo.country    || 'Void',
            isp:     geo.isp        || 'Dark Web',
            lat: geo.lat || null, lon: geo.lon || null,
            ua, ...uaInfo,
            page:      (req.body.page      || 'Root').slice(0, 200),
            screen:    (req.body.screen    || 'Unknown').slice(0, 30),
            referrer:  (req.body.referrer  || '').slice(0, 300),
            sessionId: (req.body.sessionId || '').slice(0, 64),
            flags
        });

        res.status(200).send('OK');
    } catch (err) {
        console.error('Ingestion Error:', err.message);
        res.status(500).send('ERR');
    }
});

// =============================================================================
// ROUTE 2 — Telemetry (dashboard data)
// GET /api/telemetry
// =============================================================================
app.get('/api/telemetry', adminLimiter, requireAuth, async (req, res) => {
    try {
        // Build match query
        const match = {};

        if (req.query.search) {
            const esc = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 50);
            const rx  = new RegExp(esc, 'i');
            match.$or = [{ ip: rx }, { isp: rx }, { city: rx }, { country: rx }, { page: rx }];
        }
        if (req.query.device   && req.query.device   !== 'ALL') match.device   = req.query.device;
        if (req.query.platform && req.query.platform !== 'ALL') match.platform = req.query.platform;
        if (req.query.browser  && req.query.browser  !== 'ALL') match.browser  = req.query.browser;
        if (req.query.country  && req.query.country  !== 'ALL') match.country  = req.query.country;
        if (req.query.flag     && req.query.flag     !== 'ALL') match.flags    = req.query.flag;

        // Date range
        if (req.query.dateFrom || req.query.dateTo) {
            match.timestamp = {};
            if (req.query.dateFrom) match.timestamp.$gte = new Date(req.query.dateFrom);
            if (req.query.dateTo)   match.timestamp.$lte = new Date(req.query.dateTo + 'T23:59:59Z');
        }

        // Pagination
        const page  = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, parseInt(req.query.limit) || 100);
        const skip  = (page - 1) * limit;

        // Sort
        const sortField = ['timestamp','ip','city','country','browser'].includes(req.query.sort) ? req.query.sort : 'timestamp';
        const sortDir   = req.query.sortDir === 'asc' ? 1 : -1;

        // Run all queries in parallel
        const [logs, totalHits, uniqueIPsArr, devices, platforms, browsers, locations, pages, timeline, todayCount, yesterdayCount, botCount] = await Promise.all([
            Log.find(match).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
            Log.countDocuments(match),
            Log.distinct('ip', match),
            Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ['$device',   'Unknown'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
            Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ['$platform', 'Unknown'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
            Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ['$browser',  'Unknown'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
            Log.aggregate([{ $match: match }, { $group: { _id: { city: '$city', country: '$country' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }]),
            Log.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ['$page', '/'] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 8 }]),
            Log.aggregate([
                { $match: { ...match, timestamp: { $gte: new Date(Date.now() - 7 * 86400000) } } },
                { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, count: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ]),
            // Today count
            Log.countDocuments({ ...match, timestamp: { $gte: new Date(new Date().setHours(0,0,0,0)) } }),
            // Yesterday count
            Log.countDocuments({ ...match, timestamp: {
                $gte: new Date(new Date().setHours(0,0,0,0) - 86400000),
                $lt:  new Date(new Date().setHours(0,0,0,0))
            }}),
            // Bot count
            Log.countDocuments({ ...match, flags: 'bot' })
        ]);

        res.json({
            logs,
            pagination: { page, limit, total: totalHits, pages: Math.ceil(totalHits / limit) },
            stats: {
                totalHits, uniqueIPs: uniqueIPsArr.length,
                todayCount, yesterdayCount, botCount,
                devices, platforms, browsers, locations, pages, timeline
            }
        });
    } catch (err) {
        console.error('Telemetry Error:', err.message);
        res.status(500).json({ error: 'SYSTEM CRASH' });
    }
});

// =============================================================================
// ROUTE 3 — Delete a single log entry
// DELETE /api/logs/:id
// =============================================================================
app.delete('/api/logs/:id', adminLimiter, requireAuth, async (req, res) => {
    try {
        await Log.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'DELETE FAILED' });
    }
});

// =============================================================================
// ROUTE 4 — Blocklist management
// GET  /api/blocklist        — list all blocked IPs
// POST /api/blocklist        — add IP to blocklist
// DELETE /api/blocklist/:ip  — remove IP from blocklist
// =============================================================================
app.get('/api/blocklist', adminLimiter, requireAuth, async (req, res) => {
    const list = await Block.find().sort({ createdAt: -1 }).lean();
    res.json(list);
});

app.post('/api/blocklist', adminLimiter, requireAuth, async (req, res) => {
    try {
        const ip     = (req.body.ip || '').trim().slice(0, 45);
        const reason = (req.body.reason || 'Manual block').slice(0, 100);
        if (!ip) return res.status(400).json({ error: 'IP required' });
        await Block.findOneAndUpdate({ ip }, { ip, reason }, { upsert: true, new: true });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'BLOCK FAILED' });
    }
});

app.delete('/api/blocklist/:ip', adminLimiter, requireAuth, async (req, res) => {
    try {
        await Block.findOneAndDelete({ ip: req.params.ip });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'UNBLOCK FAILED' });
    }
});

// =============================================================================
// ROUTE 5 — Health check
// GET /api/health
// =============================================================================
app.get('/api/health', async (req, res) => {
    const status = {
        analytics: 'ONLINE',
        database:  mongoose.connection.readyState === 1 ? 'ONLINE' : 'OFFLINE',
        mainSite:  'OFFLINE',
        checkIns:  'OFFLINE',
        uptime:    Math.floor(process.uptime()) + 's',
        memMB:     Math.round(process.memoryUsage().rss / 1024 / 1024)
    };
    try { await axios.get('https://letrollologist.github.io/anya.github.io/index.html', { timeout: 5000 }); status.mainSite = 'ONLINE'; } catch {}
    try { await axios.head('https://overdefensively-unabjective-eilene.ngrok-free.dev/', { timeout: 5000 }); status.checkIns = 'ONLINE'; } catch {}
    res.json(status);
});

// =============================================================================
// ROUTE 6 — Admin dashboard HTML shell
// GET /admin?pw=...
// =============================================================================
app.get('/admin', adminLimiter, (req, res) => {
    const secret = process.env.ADMIN_PW;
    if (!secret)            return res.status(500).send('SERVER MISCONFIGURED');
    if (req.query.pw !== secret) return res.status(401).send('ACCESS DENIED');
    res.sendFile(path.join(__dirname, 'assets', 'admin.html'));
});

// Static assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('SENTINEL ONLINE — Port:', PORT));
