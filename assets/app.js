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
    methods: {
        async fetchHealth() {
            try {
                // Correct Node.js route
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
                // Correct Node.js route
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
                // Safely merge so charts never receive undefined arrays
                this.stats = {
                    totalHits:  data.stats?.totalHits  ?? 0,
                    uniqueIPs:  data.stats?.uniqueIPs  ?? 0,
                    devices:    data.stats?.devices    ?? [],
                    platforms:  data.stats?.platforms  ?? [],
                    browsers:   data.stats?.browsers   ?? [],
                    locations:  data.stats?.locations  ?? [],
                    timeline:   data.stats?.timeline   ?? []
                };
                this.updateCharts();
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
        openDeepScan(log) {
            this.selectedLog = log;
        },
        formatDate(dateStr) {
            const d = new Date(dateStr);
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour12: false });
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
                data: { labels: [], datasets: [{ data: [], backgroundColor: ['#ff00ff', '#00f3ff', '#3b82f6'], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }
            });

            const platCtx = document.getElementById('platformChart').getContext('2d');
            this.charts.platform = new Chart(platCtx, {
                type: 'doughnut',
                data: { labels: [], datasets: [{ data: [], backgroundColor: ['#00f3ff', '#ff00ff', '#8b5cf6', '#10b981', '#f59e0b'], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }
            });

            const broCtx = document.getElementById('browserChart').getContext('2d');
            this.charts.browser = new Chart(broCtx, {
                type: 'doughnut',
                data: { labels: [], datasets: [{ data: [], backgroundColor: ['#fcd34d', '#f43f5e', '#3b82f6', '#10b981', '#a855f7', '#64748b'], borderWidth: 0 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '70%' }
            });
        },
        updateCharts() {
            if (!this.charts.timeline) return;

            this.charts.timeline.data.labels = this.stats.timeline.map(t => t._id.substring(5));
            this.charts.timeline.data.datasets[0].data = this.stats.timeline.map(t => t.count);
            this.charts.timeline.update();

            this.charts.device.data.labels = this.stats.devices.map(d => d._id);
            this.charts.device.data.datasets[0].data = this.stats.devices.map(d => d.count);
            this.charts.device.update();

            this.charts.platform.data.labels = this.stats.platforms.map(p => p._id);
            this.charts.platform.data.datasets[0].data = this.stats.platforms.map(p => p.count);
            this.charts.platform.update();

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
        this.healthInterval = setInterval(() => this.fetchHealth(), 30000);
    },
    unmounted() {
        clearInterval(this.pollInterval);
        clearInterval(this.healthInterval);
    }
}).mount('#app');
