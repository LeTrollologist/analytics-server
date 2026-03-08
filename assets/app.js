const { createApp } = Vue;
const API_PW = new URLSearchParams(window.location.search).get('pw');

createApp({
    data() {
        return {
            activeTab: 'dashboard',
            tabs: [
                { id: 'dashboard', label: '⬡ Dashboard' },
                { id: 'blocklist', label: '⛔ Blocklist' }
            ],
            logs: [],
            stats: {
                totalHits: 0, uniqueIPs: 0, todayCount: 0, yesterdayCount: 0, botCount: 0,
                devices: [], platforms: [], browsers: [], locations: [], pages: [], timeline: []
            },
            pagination: { page: 1, pages: 1, total: 0, limit: 100 },
            filters: { search: '', device: 'ALL', platform: 'ALL', browser: 'ALL', flag: 'ALL', dateFrom: '', dateTo: '' },
            sort: { field: 'timestamp', dir: 'desc' },
            health: { database: 'SCANNING', mainSite: 'SCANNING', checkIns: 'SCANNING' },
            isLive: true,
            loading: false,
            pollInterval: null,
            healthInterval: null,
            selectedLog: null,
            charts: {},
            blocklist: [],
            blockForm: { ip: '', reason: '' },
            toast: { msg: '', type: 'ok' },
            toastTimer: null
        };
    },

    computed: {
        hardwareRows() { return this._pctRows(this.stats.devices  || []); },
        platformRows() { return this._pctRows(this.stats.platforms || []); },
        browserRows()  { return this._pctRows(this.stats.browsers  || []); }
    },

    methods: {
        // ── Utility ──────────────────────────────────────────────────────────
        _pctRows(arr) {
            const total = arr.reduce((s, x) => s + x.count, 0) || 1;
            return [...arr]
                .map(x => ({ label: x._id, count: x.count, pct: Math.round((x.count / total) * 100) }))
                .sort((a, b) => b.count - a.count);
        },
        barColor(i) {
            return ['#00f3ff','#ff00ff','#8b5cf6','#10b981','#f59e0b','#f43f5e'][i % 6];
        },
        formatDate(d) {
            if (!d) return '—';
            const dt = new Date(d);
            return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour12: false });
        },
        showToast(msg, type = 'ok') {
            clearTimeout(this.toastTimer);
            this.toast = { msg, type };
            this.toastTimer = setTimeout(() => { this.toast.msg = ''; }, 3000);
        },

        // ── Sort ─────────────────────────────────────────────────────────────
        setSort(field) {
            if (this.sort.field === field) {
                this.sort.dir = this.sort.dir === 'desc' ? 'asc' : 'desc';
            } else {
                this.sort.field = field;
                this.sort.dir = 'desc';
            }
            this.fetchData();
        },
        sortIndicator(field) {
            if (this.sort.field !== field) return '';
            return this.sort.dir === 'desc' ? '▼' : '▲';
        },

        // ── Pagination ───────────────────────────────────────────────────────
        changePage(delta) {
            const next = this.pagination.page + delta;
            if (next < 1 || next > this.pagination.pages) return;
            this.pagination.page = next;
            this.fetchData();
        },

        // ── Data fetching ────────────────────────────────────────────────────
        async fetchHealth() {
            try {
                const r = await fetch('/api/health');
                if (r.ok) this.health = await r.json();
            } catch {
                this.health = { database: 'OFFLINE', mainSite: 'OFFLINE', checkIns: 'OFFLINE' };
            }
        },

        async fetchData() {
            this.loading = true;
            try {
                const p = new URLSearchParams({
                    pw:      API_PW,
                    page:    this.pagination.page,
                    limit:   this.pagination.limit,
                    sort:    this.sort.field,
                    sortDir: this.sort.dir,
                    ...this.filters
                });
                const r = await fetch('/api/telemetry?' + p);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const data = await r.json();
                if (data.error) { this.showToast(data.error, 'err'); return; }

                this.logs       = data.logs || [];
                this.pagination = { ...this.pagination, ...data.pagination };
                this.stats      = {
                    totalHits:      data.stats?.totalHits      ?? 0,
                    uniqueIPs:      data.stats?.uniqueIPs      ?? 0,
                    todayCount:     data.stats?.todayCount     ?? 0,
                    yesterdayCount: data.stats?.yesterdayCount ?? 0,
                    botCount:       data.stats?.botCount       ?? 0,
                    devices:        data.stats?.devices        ?? [],
                    platforms:      data.stats?.platforms      ?? [],
                    browsers:       data.stats?.browsers       ?? [],
                    locations:      data.stats?.locations      ?? [],
                    pages:          data.stats?.pages          ?? [],
                    timeline:       data.stats?.timeline       ?? []
                };
                // Update the chart with fresh data — do NOT re-init here,
                // only update the existing instance to avoid the fullSize crash.
                this.updateTimeline();
            } catch (e) {
                console.error('Uplink failed:', e.message);
            } finally {
                this.loading = false;
            }
        },

        debouncedFetch() {
            clearTimeout(this._debounce);
            this._debounce = setTimeout(() => {
                this.pagination.page = 1;
                this.fetchData();
            }, 450);
        },

        resetFilters() {
            this.filters = { search: '', device: 'ALL', platform: 'ALL', browser: 'ALL', flag: 'ALL', dateFrom: '', dateTo: '' };
            this.pagination.page = 1;
            this.sort = { field: 'timestamp', dir: 'desc' };
            this.fetchData();
        },

        // ── Actions ──────────────────────────────────────────────────────────
        async deleteLog(id) {
            if (!confirm('Delete this log entry?')) return;
            try {
                const r = await fetch(`/api/logs/${id}?pw=${API_PW}`, { method: 'DELETE' });
                const d = await r.json();
                if (d.ok) { this.showToast('Entry deleted'); this.fetchData(); }
                else this.showToast('Delete failed', 'err');
            } catch { this.showToast('Delete failed', 'err'); }
        },

        async blockIP(ip) {
            const reason = prompt(`Block reason for ${ip}:`, 'Manual block');
            if (reason === null) return;
            try {
                const r = await fetch(`/api/blocklist?pw=${API_PW}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ip, reason })
                });
                const d = await r.json();
                if (d.ok) { this.showToast(`${ip} blocked`); this.fetchBlocklist(); }
                else this.showToast('Block failed', 'err');
            } catch { this.showToast('Block failed', 'err'); }
        },

        // ── Blocklist tab ─────────────────────────────────────────────────────
        async fetchBlocklist() {
            try {
                const r = await fetch(`/api/blocklist?pw=${API_PW}`);
                if (r.ok) this.blocklist = await r.json();
            } catch { this.showToast('Could not load blocklist', 'err'); }
        },

        async addBlock() {
            if (!this.blockForm.ip) return;
            await this.blockIP(this.blockForm.ip);
            this.blockForm = { ip: '', reason: '' };
        },

        async removeBlock(ip) {
            try {
                const r = await fetch(`/api/blocklist/${encodeURIComponent(ip)}?pw=${API_PW}`, { method: 'DELETE' });
                const d = await r.json();
                if (d.ok) { this.showToast(`${ip} unblocked`); this.fetchBlocklist(); }
                else this.showToast('Unblock failed', 'err');
            } catch { this.showToast('Unblock failed', 'err'); }
        },

        // ── CSV export ───────────────────────────────────────────────────────
        exportCSV() {
            if (!this.logs.length) return;
            const hdr = ['Time','IP','City','Country','ISP','Device','OS','Browser','Page','Referrer','Flags'];
            const rows = this.logs.map(l =>
                [this.formatDate(l.timestamp), l.ip, l.city, l.country, l.isp,
                 l.device, l.platform, l.browser, l.page, l.referrer,
                 (l.flags||[]).join('|')]
                .map(v => `"${(v||'').toString().replace(/"/g,'""')}"`)
                .join(',')
            );
            const blob = new Blob([[hdr.join(','), ...rows].join('\n')], { type: 'text/csv' });
            const a = Object.assign(document.createElement('a'), {
                href: URL.createObjectURL(blob),
                download: `sentinel_${Date.now()}.csv`
            });
            a.click();
            URL.revokeObjectURL(a.href);
        },

        // ── Live polling ─────────────────────────────────────────────────────
        toggleLive() {
            this.isLive = !this.isLive;
            if (this.isLive) this.startPolling(); else clearInterval(this.pollInterval);
        },
        startPolling() {
            clearInterval(this.pollInterval);
            this.pollInterval = setInterval(() => { if (!this.loading) this.fetchData(); }, 6000);
        },

        openDeepScan(log) { this.selectedLog = log; },

        // ── Chart ─────────────────────────────────────────────────────────────
        // Always destroy the old instance before creating a new one.
        // Chart.js throws "Cannot set properties of undefined (setting 'fullSize')"
        // when you try to attach a second chart to a canvas that already has one,
        // which then cascades into an infinite retry loop (call stack overflow).
        initTimeline() {
            const canvas = document.getElementById('timelineChart');
            if (!canvas) return; // not in DOM yet (wrong tab), bail silently

            if (this.charts.timeline) {
                this.charts.timeline.destroy();
                this.charts.timeline = null;
            }

            Chart.defaults.color = '#444';
            Chart.defaults.font.family = "'JetBrains Mono', monospace";

            this.charts.timeline = new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Hits',
                        data: [],
                        backgroundColor: 'rgba(0,243,255,0.2)',
                        borderColor: '#00f3ff',
                        borderWidth: 1,
                        borderRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: {
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            ticks: { maxTicksLimit: 5 },
                            beginAtZero: true
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        },

        // Only update data — never re-init from here.
        // If the chart doesn't exist (not yet created or canvas was absent),
        // attempt one init and then return.
        updateTimeline() {
            if (!this.charts.timeline) {
                this.initTimeline();
                if (!this.charts.timeline) return; // canvas still not in DOM
            }
            const tl = this.stats.timeline || [];
            this.charts.timeline.data.labels           = tl.map(t => t._id.slice(5));
            this.charts.timeline.data.datasets[0].data = tl.map(t => t.count);
            this.charts.timeline.update('none');
        }
    },

    watch: {
        activeTab(tab) {
            if (tab === 'blocklist') this.fetchBlocklist();
            // When switching back to dashboard, wait for Vue to render the
            // canvas into the DOM, then re-init the chart cleanly.
            if (tab === 'dashboard') {
                this.$nextTick(() => {
                    this.initTimeline();
                    this.updateTimeline();
                });
            }
        }
    },

    mounted() {
        this.$nextTick(() => {
            this.initTimeline();
        });
        this.fetchHealth();
        this.fetchData();
        this.startPolling();
        this.healthInterval = setInterval(() => this.fetchHealth(), 30000);
    },

    unmounted() {
        clearInterval(this.pollInterval);
        clearInterval(this.healthInterval);
        if (this.charts.timeline) {
            this.charts.timeline.destroy();
            this.charts.timeline = null;
        }
    }
}).mount('#app');
