const { createApp } = Vue;
const API_PW = new URLSearchParams(window.location.search).get('pw');

createApp({
    data() {
        return {
            logs: [],
            stats: { totalHits: 0, uniqueIPs: 0, devices: [], platforms: [], browsers: [], locations: [], timeline: [] },
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
    computed: {
        hardwareRows() {
            const total = (this.stats.devices || []).reduce((a, b) => a + b.count, 0) || 1;
            return (this.stats.devices || [])
                .map(d => ({ label: d._id, count: d.count, pct: Math.round((d.count / total) * 100) }))
                .sort((a, b) => b.count - a.count);
        },
        platformRows() {
            const total = (this.stats.platforms || []).reduce((a, b) => a + b.count, 0) || 1;
            return (this.stats.platforms || [])
                .map(p => ({ label: p._id, count: p.count, pct: Math.round((p.count / total) * 100) }))
                .sort((a, b) => b.count - a.count);
        },
        browserRows() {
            const total = (this.stats.browsers || []).reduce((a, b) => a + b.count, 0) || 1;
            return (this.stats.browsers || [])
                .map(b => ({ label: b._id, count: b.count, pct: Math.round((b.count / total) * 100) }))
                .sort((a, b) => b.count - a.count);
        }
    },
    methods: {
        async fetchHealth() {
            try {
                const res = await fetch('/api/health');
                if (res.ok) this.health = await res.json();
            } catch (e) {
                this.health = { database: 'OFFLINE', mainSite: 'OFFLINE', checkIns: 'OFFLINE' };
            }
        },
        async fetchData() {
            this.loading = true;
            try {
                const params = new URLSearchParams({ pw: API_PW, ...this.filters });
                const res = await fetch('/api/telemetry?' + params.toString());

                if (!res.ok) {
                    const errorText = await res.text();
                    throw new Error(`HTTP ${res.status}: ${errorText}`);
                }

                const data = await res.json();

                if (data.error) {
                    console.error("API Error:", data.error);
                    alert("ACCESS DENIED: " + data.error);
                    this.isLive = false;
                    clearInterval(this.pollInterval);
                    return;
                }

                this.logs = data.logs || [];
                this.stats = {
                    totalHits:  data.stats?.totalHits  ?? 0,
                    uniqueIPs:  data.stats?.uniqueIPs  ?? 0,
                    devices:    data.stats?.devices    ?? [],
                    platforms:  data.stats?.platforms  ?? [],
                    browsers:   data.stats?.browsers   ?? [],
                    locations:  data.stats?.locations  ?? [],
                    timeline:   data.stats?.timeline   ?? []
                };
                this.updateTimeline();
            } catch (e) {
                console.error("Uplink failed. Reason:", e.message || e);
            } finally {
                this.loading = false;
            }
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
            const headers = ['Time', 'Target_IP', 'City', 'Country', 'ISP', 'Hardware', 'OS', 'Browser', 'Page'];
            const rows = this.logs.map(l =>
                [this.formatDate(l.timestamp), l.ip, l.city, l.country, l.isp, l.device, l.platform, l.browser, l.page]
                    .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
                    .join(',')
            );
            const csvContent = [headers.join(','), ...rows].join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sentinel_intercepts_${new Date().getTime()}.csv`;
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
        openDeepScan(log) { this.selectedLog = log; },
        formatDate(dateStr) {
            const d = new Date(dateStr);
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour12: false });
        },
        barColor(index) {
            return ['#00f3ff', '#ff00ff', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e'][index % 6];
        },
        initTimeline() {
            Chart.defaults.color = '#555';
            Chart.defaults.font.family = "'JetBrains Mono', monospace";
            const ctx = document.getElementById('timelineChart').getContext('2d');
            this.charts.timeline = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Signals',
                        data: [],
                        backgroundColor: 'rgba(0, 243, 255, 0.25)',
                        borderColor: '#00f3ff',
                        borderWidth: 1,
                        borderRadius: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: {
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: { color: '#555', maxTicksLimit: 5 },
                            beginAtZero: true
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#555' }
                        }
                    }
                }
            });
        },
        updateTimeline() {
            if (!this.charts.timeline) return;
            const tl = this.stats.timeline || [];
            this.charts.timeline.data.labels = tl.map(t => t._id.substring(5));
            this.charts.timeline.data.datasets[0].data = tl.map(t => t.count);
            this.charts.timeline.update();
        }
    },
    mounted() {
        this.initTimeline();
        this.fetchHealth();
        this.fetchData();
        this.startPolling();
        this.healthInterval = setInterval(() => this.fetchHealth(), 30000);
    },
    unmounted() {
        clearInterval(this.pollInterval);
        clearInterval(this.healthInterval);
    }
}).mount('#app');
