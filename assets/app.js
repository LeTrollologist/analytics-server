const express  = require('express');
const axios    = require('axios');
const mongoose = require('mongoose');
const cors     = require('cors');
const rateLimit = require('express-rate-limit');
const path     = require('path');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOptions = {
    origin: 'https://letrollologist.github.io',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
};
const ghCors = cors(corsOptions);

// Handle OPTIONS preflight globally for every route.
app.options('*', cors(corsOptions));

// ── Rate limiters ─────────────────────────────────────────────────────────────
const logLimiter = rateLimit({
    windowMs: 60 * 1000, max: 20,
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
    page: String, screen: String, vp: String,
    referrer: String,
    sessionId: String,
    flags: { type: [String], default: [] },
    lang: String,
    tz: String,
    dpr: Number,
    col: String,
    sessViews: Number,
    loadTime: Number,
    euScrubbed: { type: Boolean, default: false, index: true }
});
const Log = mongoose.model('Log', LogSchema);

const EventSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    sessionId: String,
    event: { type: String, index: true },
    data: mongoose.Schema.Types.Mixed,
    page: String
});
const Event = mongoose.model('Event', EventSchema);

const BlockSchema = new mongoose.Schema({
    ip:        { type: String, unique: true },
    reason:    String,
    createdAt: { type: Date, default: Date.now }
});
const Block = mongoose.model('Block', BlockSchema);

const ActiveSessionSchema = new mongoose.Schema({
    sessionId: { type: String, unique: true, index: true },
    ip: String,
    city: String,
    region: String,
    country: String,
    page: String,
    sector: String,
    device: String,
    browser: String,
    startedAt: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now, index: true },
    duration: { type: Number, default: 0 },
    euScrubbed: { type: Boolean, default: false }
});
const ActiveSession = mongoose.model('ActiveSession', ActiveSessionSchema);

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseUA(ua) {
    let device = 'Desktop Station', platform = 'Unknown OS', browser = 'Unknown Browser';
    if (!ua) return { device, platform, browser };
    if (/mobile/i.test(ua))      device = 'Mobile Unit';
    else if (/tablet/i.test(ua)) device = 'Tablet Unit';
    if      (/Windows/i.test(ua))                        platform = 'Windows Core';
    else if (/iPhone|iPad|iPod/i.test(ua))               platform = 'iOS Node';
    else if (/Android/i.test(ua))                        platform = 'Android Mesh';
    else if (/Macintosh|Mac OS/i.test(ua))               platform = 'MacOS Kernel';
    else if (/Linux/i.test(ua))                          platform = 'Linux System';
    if      (/Edg/i.test(ua))                            browser  = 'Edge';
    else if (/OPR|Opera/i.test(ua))                      browser  = 'Opera';
    else if (/Chrome/i.test(ua))                         browser  = 'Chrome';
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser  = 'Safari';
    else if (/Firefox/i.test(ua))                        browser  = 'Firefox';
    return { device, platform, browser };
}

function detectFlags(ua) {
    const flags = [];
    if (!ua || /bot|crawl|spider|slurp|curl|wget|python|java|go-http/i.test(ua)) flags.push('bot');
    return flags;
}

function isEU(countryCode, tz) {
    const euCountries = [
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 
        'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 
        'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH', 'NO', 
        'IS', 'LI'
    ];
    if (countryCode && euCountries.includes(countryCode.toUpperCase())) return true;
    if (tz && tz.toLowerCase().startsWith('europe/')) return true;
    return false;
}

async function upsertSession(log) {
    try {
        let sector = 'Core SPA';
        const pageLower = (log.page || '').toLowerCase();
        if (pageLower.includes('sketchin')) sector = 'Sketchbook';
        else if (pageLower.includes('grovein')) sector = 'Grove';
        else if (pageLower.includes('planner')) sector = 'Planner';
        else if (pageLower.includes('index') || pageLower === '/' || pageLower.includes('gamein')) sector = 'Core SPA';

        await ActiveSession.findOneAndUpdate(
            { sessionId: log.sessionId },
            {
                sessionId: log.sessionId,
                ip: log.ip,
                city: log.city,
                region: log.region,
                country: log.country,
                page: log.page,
                sector,
                device: log.device,
                browser: log.browser,
                startedAt: log.timestamp || new Date(),
                lastSeen: new Date(),
                duration: 0,
                euScrubbed: log.euScrubbed
            },
            { upsert: true }
        );
    } catch (e) {
        console.error('Session upsert failed:', e.message);
    }
}

function requireAuth(req, res, next) {
    const secret = process.env.ADMIN_PW;
    if (!secret) return res.status(500).json({ error: 'SERVER MISCONFIGURED' });
    if (req.query.pw !== secret) return res.status(401).json({ error: 'ACCESS DENIED' });
    next();
}

// ── Keep-alive self-ping ───────────────────────────────────────────────────────
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
app.post('/log', ghCors, logLimiter, async (req, res) => {
    try {
        const raw     = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const cleanIp = raw.split(',')[0].trim();
        const isLocal = ['127.0.0.1','::1'].includes(cleanIp)
            || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.');

        const blocked = await Block.findOne({ ip: cleanIp });
        if (blocked) return res.status(200).send('OK');

        let geo = {};
        if (!isLocal) {
            const g = await axios.get(
                `http://ip-api.com/json/${cleanIp}?fields=status,city,regionName,country,countryCode,isp,lat,lon,proxy,hosting`,
                { timeout: 4000 }
            ).catch(() => ({ data: {} }));
            geo = g.data || {};
        } else {
            geo = { city: 'Localhost', regionName: 'LAN', country: 'Internal', countryCode: 'US', isp: 'Local', lat: 0, lon: 0 };
        }

        const tz = req.body.tz || '';
        const countryCode = geo.countryCode || '';
        const euStatus = isEU(countryCode, tz);

        let finalIp = cleanIp;
        let city = geo.city || 'Void';
        let region = geo.regionName || 'Void';
        let country = geo.country || 'Void';
        let lat = geo.lat || null;
        let lon = geo.lon || null;
        let ua = (req.body.ua || '').slice(0, 500);
        let sessionId = (req.body.sessionId || '').slice(0, 64);
        let flags  = detectFlags(ua);

        if (geo.proxy || geo.hosting) flags.push('vpn/proxy');

        if (euStatus) {
            flags.push('EU-GDPR-Shield');
            // IP masking compliance
            if (cleanIp.includes('.')) {
                const parts = cleanIp.split('.');
                parts[3] = '0';
                finalIp = parts.join('.');
            } else if (cleanIp.includes(':')) {
                finalIp = '[EU ANONYMIZED IP]';
            }
            city = '[EU PRIVACY SCRUBBED]';
            region = '[EU PRIVACY SCRUBBED]';
            lat = null;
            lon = null;
            sessionId = '[EU ANONYMIZED]';
            ua = '[EU PRIVACY SCRUBBED]';
        }

        const uaInfo = parseUA(euStatus ? (req.body.ua || '') : ua);

        const newLog = await Log.create({
            ip:      finalIp,
            city, region, country,
            isp:     geo.isp        || 'Dark Web',
            lat, lon,
            ua, ...uaInfo,
            page:      (req.body.page      || 'Root').slice(0, 200),
            screen:    (req.body.screen    || 'Unknown').slice(0, 30),
            vp:        (req.body.vp        || 'Unknown').slice(0, 30),
            referrer:  (req.body.referrer  || '').slice(0, 300),
            sessionId,
            flags,
            lang:      (req.body.lang      || 'en').slice(0, 10),
            tz:        (req.body.tz        || 'UTC').slice(0, 40),
            dpr:       parseFloat(req.body.dpr) || 1,
            col:       (req.body.col       || '24bit').slice(0, 10),
            sessViews: parseInt(req.body.sessViews) || 1,
            loadTime:  typeof req.body.loadTime === 'number' ? req.body.loadTime : null,
            euScrubbed: euStatus
        });

        await upsertSession(newLog);

        res.status(200).send('OK');
    } catch (err) {
        console.error('Ingestion Error:', err.message);
        res.status(500).send('ERR');
    }
});

// =============================================================================
// ROUTE 1B — Ingest custom events tracker SDK
// POST /log/event
// =============================================================================
app.post('/log/event', ghCors, logLimiter, async (req, res) => {
    try {
        const sessionId = (req.body.sessionId || '').slice(0, 64);
        const event = (req.body.event || '').slice(0, 50);
        const page = (req.body.page || '').slice(0, 200);
        const data = req.body.data || {};
        
        if (!event) return res.status(400).send('EVENT REQUIRED');

        await Event.create({
            sessionId,
            event,
            data,
            page,
            timestamp: new Date()
        });

        res.status(200).send('OK');
    } catch (err) {
        console.error('Event Ingestion Error:', err.message);
        res.status(500).send('ERR');
    }
});

// =============================================================================
// ROUTE 1C ── Ingest active periodic page heartbeats
// POST /log/heartbeat
// =============================================================================
app.post('/log/heartbeat', ghCors, logLimiter, async (req, res) => {
    try {
        const sessionId = (req.body.sessionId || '').slice(0, 64);
        const page = (req.body.page || '').slice(0, 200);
        const sector = (req.body.sector || 'Core SPA').slice(0, 40);
        const duration = parseFloat(req.body.duration) || 0;
        
        if (!sessionId) return res.status(400).send('SESSION_ID REQUIRED');

        await ActiveSession.findOneAndUpdate(
            { sessionId },
            {
                lastSeen: new Date(),
                page,
                sector,
                duration
            }
        );

        res.status(200).send('OK');
    } catch (err) {
        console.error('Heartbeat Ingestion Error:', err.message);
        res.status(500).send('ERR');
    }
});

// =============================================================================
// ROUTE 2 — Telemetry (dashboard data)
// GET /api/telemetry
// =============================================================================
app.get('/api/telemetry', adminLimiter, requireAuth, async (req, res) => {
    try {
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

        if (req.query.euStatus) {
            if (req.query.euStatus === 'SHIELDED') match.euScrubbed = true;
            else if (req.query.euStatus === 'STANDARD') match.euScrubbed = { $ne: true };
        }

        if (req.query.dateFrom || req.query.dateTo) {
            match.timestamp = {};
            if (req.query.dateFrom) match.timestamp.$gte = new Date(req.query.dateFrom);
            if (req.query.dateTo)   match.timestamp.$lte = new Date(req.query.dateTo + 'T23:59:59Z');
        }

        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(200, parseInt(req.query.limit) || 100);
        const skip  = (page - 1) * limit;

        const sortField = ['timestamp','ip','city','country','browser'].includes(req.query.sort)
            ? req.query.sort : 'timestamp';
        const sortDir = req.query.sortDir === 'asc' ? 1 : -1;

        const activeSessionsCutoff = new Date(Date.now() - 15 * 60 * 1000);

        const [
            logs, activeSessions, totalHits, uniqueIPsArr,
            devices, platforms, browsers,
            locations, pages, timeline,
            todayCount, yesterdayCount, botCount,
            avgLoadRes, euShieldedCount
        ] = await Promise.all([
            Log.find(match).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
            ActiveSession.find({ lastSeen: { $gte: activeSessionsCutoff } }).sort({ lastSeen: -1 }).lean(),
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
            Log.countDocuments({ ...match, timestamp: { $gte: new Date(new Date().setHours(0,0,0,0)) } }),
            Log.countDocuments({ ...match, timestamp: {
                $gte: new Date(new Date().setHours(0,0,0,0) - 86400000),
                $lt:  new Date(new Date().setHours(0,0,0,0))
            }}),
            Log.countDocuments({ ...match, flags: 'bot' }),
            Log.aggregate([
                { $match: { ...match, loadTime: { $ne: null } } },
                { $group: { _id: null, avgLoad: { $avg: '$loadTime' } } }
            ]),
            Log.countDocuments({ ...match, euScrubbed: true })
        ]);

        const avgLoadTime = avgLoadRes.length > 0 ? Math.round(avgLoadRes[0].avgLoad) : 0;

        res.json({
            logs,
            activeSessions,
            pagination: { page, limit, total: totalHits, pages: Math.ceil(totalHits / limit) },
            stats: {
                totalHits, uniqueIPs: uniqueIPsArr.length,
                todayCount, yesterdayCount, botCount,
                devices, platforms, browsers, locations, pages, timeline,
                avgLoadTime, euShieldedCount
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
// =============================================================================
app.get('/api/health', ghCors, async (req, res) => {
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
// =============================================================================
app.get('/admin', adminLimiter, (req, res) => {
    const secret = process.env.ADMIN_PW;
    if (!secret)                 return res.status(500).send('SERVER MISCONFIGURED');
    if (req.query.pw !== secret) return res.status(401).send('ACCESS DENIED');
    res.sendFile(path.join(__dirname, 'assets', 'admin.html'));
});

app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Background job: Purge EU citizen logs older than 24 hours (GDPR data minimization compliance)
setInterval(async () => {
    try {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours retention limit
        
        const resLog = await Log.deleteMany({
            $or: [
                { euScrubbed: true },
                { country: { $in: ['Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'United Kingdom', 'Switzerland', 'Norway', 'Iceland', 'Liechtenstein'] } },
                { tz: { $regex: /^europe\//i } }
            ],
            timestamp: { $lt: cutoff }
        });

        const resSess = await ActiveSession.deleteMany({
            $or: [
                { euScrubbed: true },
                { country: { $in: ['Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'United Kingdom', 'Switzerland', 'Norway', 'Iceland', 'Liechtenstein'] } }
            ],
            lastSeen: { $lt: cutoff }
        });

        if (resLog.deletedCount > 0 || resSess.deletedCount > 0) {
            console.log(`[GDPR SHIELD] Automatically purged ${resLog.deletedCount} EU citizen telemetry logs and ${resSess.deletedCount} session logs matching 24h retention limit.`);
        }
    } catch (err) {
        console.error('[GDPR SHIELD] Error running data retention purge:', err.message);
    }
}, 60 * 60 * 1000); // run every hour

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log('SENTINEL ONLINE — Port:', PORT));
