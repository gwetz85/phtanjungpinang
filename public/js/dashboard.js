/**
 * Dashboard SPA Controller
 */

const dashboard = {
  currentPanel: null,
  user: null,

  init() {
    if (!auth.requireAuth()) return;
    this.user = auth.getUser();
    if (!this.user) { auth.logout(); return; }

    this.renderUserInfo();
    this.renderNav();
    this.setupLogout();
    this.startClock();
    this.initNews();
    this.initWeather();
    this.loadSystemInfo();

    // Navigate to default panel
    this.navigate('panel-home');
  },

  async loadSystemInfo() {
    try {
      const res = await api.get('/auth/system-info');
      if (res && res.success) {
        let deviceId = localStorage.getItem('deviceId');
        if (!deviceId) {
          deviceId = 'DEV-' + Math.random().toString(36).substr(2, 6).toUpperCase();
          localStorage.setItem('deviceId', deviceId);
        }
        
        const data = res.data;
        document.getElementById('sys-username').textContent = this.user.username;
        document.getElementById('sys-fullname').textContent = this.user.nama;
        document.getElementById('sys-deviceid').textContent = deviceId;
        document.getElementById('sys-lastlogin').textContent = data.lastLogin ? formatDateTime(data.lastLogin) : 'Baru saja';
        document.getElementById('sys-totaldata').textContent = data.totalData + ' Tamu';
        document.getElementById('sys-ip').textContent = data.ip;
      }
    } catch (e) {
      console.error('Failed to load system info', e);
    }
  },

  renderUserInfo() {
    const u = this.user;
    const headerName = document.getElementById('header-user-name');
    const headerRole = document.getElementById('header-user-role');
    const headerAvatar = document.getElementById('header-user-avatar');
    if (headerName) headerName.textContent = u.nama;
    if (headerRole) headerRole.textContent = u.role ? u.role.toUpperCase() : 'STAF';
    if (headerAvatar) headerAvatar.textContent = getInitials(u.nama) || '👤';

    const sidebarName = document.getElementById('sidebar-user-name');
    const sidebarRole = document.getElementById('sidebar-user-role');
    const sidebarAvatar = document.getElementById('sidebar-user-avatar');
    const sidebarRoleBadge = document.getElementById('sidebar-user-role-badge');
    if (sidebarName) sidebarName.textContent = u.nama;
    if (sidebarRole) sidebarRole.innerHTML = roleBadge(u.role);
    if (sidebarAvatar) sidebarAvatar.textContent = getInitials(u.nama);
    if (sidebarRoleBadge) sidebarRoleBadge.textContent = u.role ? u.role.toUpperCase() : 'STAF';
  },

  renderNav() {
    const u = this.user;
    const nav = document.getElementById('launchpad-nav') || document.getElementById('sidebar-nav');
    if (!nav) return;

    const allItems = [
      { id: 'panel-home', icon: '🏠', label: 'Beranda', desc: 'Ringkasan & Dashboard Utama', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-search', icon: '🔍', label: 'Cari Tamu', desc: 'Pencarian Cepat NIK & Nama', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-checkin', icon: '➕', label: 'Check-in Baru', desc: 'Registrasi Tamu Menginap', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-guests', icon: '📋', label: 'Semua Data Tamu', desc: 'Buku Tamu & Database Historis', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-news', icon: '📰', label: 'Berita Tanjungpinang', desc: 'Warta Terkini Daerah Realtime', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-users', icon: '👥', label: 'Manajemen Akun', desc: 'Pengelolaan Staf & Akses', roles: ['admin', 'superadmin'] },
      { id: 'panel-excel', icon: '📁', label: 'Upload Excel', desc: 'Import & Rekap Spreadsheet', roles: ['superadmin'] },
    ];

    nav.innerHTML = allItems
      .filter(item => item.roles.includes(u.role))
      .map(item => `
        <button class="nav-item" id="nav-${item.id}" onclick="dashboard.navigate('${item.id}')">
          <div class="nav-icon-wrap">${item.icon}</div>
          <div class="nav-item-content">
            <div class="nav-item-title">${item.label}</div>
            <div class="nav-item-desc">${item.desc}</div>
          </div>
          <div class="nav-item-arrow">➔</div>
        </button>
      `).join('');
  },

  navigate(panelId) {
    // Hide all panels
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Show target panel
    const panel = document.getElementById(panelId);
    if (!panel) return;
    panel.classList.add('active');

    const navBtn = document.getElementById(`nav-${panelId}`);
    if (navBtn) navBtn.classList.add('active');

    // Update header title
    const titles = {
      'panel-home': '🏠 Beranda',
      'panel-search': '🔍 Cari Tamu',
      'panel-checkin': '➕ Check-in Baru',
      'panel-guests': '📋 Semua Data Tamu',
      'panel-news': '📰 Warta & Berita Terkini Kota Tanjungpinang',
      'panel-users': '👥 Manajemen Akun',
      'panel-excel': '📁 Upload Database Excel',
    };
    document.getElementById('main-title').textContent = titles[panelId] || '';

    // Initialize panel (home always refreshes for live stats)
    if (this.currentPanel !== panelId || panelId === 'panel-home') {
      this.currentPanel = panelId;
      this.initPanel(panelId);
    }

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  },

  initPanel(panelId) {
    switch(panelId) {
      case 'panel-home':    this.loadHomeStats(); break;
      case 'panel-search':  searchPanel.init(); break;
      case 'panel-checkin': checkinModule.init(); break;
      case 'panel-guests':  guestsPanel.init(); break;
      case 'panel-news':    this.initNewsPanel(); break;
      case 'panel-users':   usersPanel.init(); break;
      case 'panel-excel':   excelPanel.init(); break;
    }
  },

  async loadHomeStats() {
    const now     = new Date();
    const today   = now.toISOString().split('T')[0];  // YYYY-MM-DD
    const yr      = now.getFullYear();
    const mo      = now.getMonth() + 1; // 1-12
    const moStr   = String(mo).padStart(2, '0');
    const monthPrefix = `${yr}-${moStr}`; // YYYY-MM

    const MONTHS_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

    // Update month label
    const monthLabel = document.getElementById('stat-month-label');
    if (monthLabel) monthLabel.textContent = `Check-in ${MONTHS_ID[mo - 1]} ${yr}`;
    const chartYearLabel = document.getElementById('chart-year-label');
    if (chartYearLabel) chartYearLabel.textContent = `Tahun ${yr}`;

    try {
      // ── 1. Total database tamu ──
      const gRes = await api.get('/guests', { page: 1, limit: 1 });
      const totalTamu = gRes.pagination?.total || 0;
      document.getElementById('stat-total-tamu').textContent = totalTamu.toLocaleString('id-ID');

      // ── 2. Ambil semua tamu (untuk hitung checkin hari ini & bulan ini) ──
      const allRes  = await api.get('/guests', { page: 1, limit: 9999 });
      const allGuests = allRes.data || [];

      let todayCount = 0;
      let monthCount = 0;

      // Monthly chart data: keyed by month number (1–12)
      const monthCounts = Array(12).fill(0);

      for (const g of allGuests) {
        const ci = g.last_checkin || '';
        if (!ci) continue;
        const ciDate = ci.substring(0, 10); // YYYY-MM-DD
        if (ciDate === today) todayCount++;
        if (ciDate.startsWith(monthPrefix)) monthCount++;
        // For chart: check year match
        if (ciDate.startsWith(`${yr}-`)) {
          const ciMo = parseInt(ciDate.substring(5, 7), 10);
          if (ciMo >= 1 && ciMo <= 12) monthCounts[ciMo - 1]++;
        }
      }

      document.getElementById('stat-today').textContent = todayCount;
      document.getElementById('stat-this-month').textContent = monthCount;

      // ── 3. Render monthly bar chart ──
      const chartEl = document.getElementById('monthly-chart');
      const chartLoading = document.getElementById('chart-loading');

      if (chartEl) {
        if (chartLoading) chartLoading.style.display = 'none';
        chartEl.style.display = 'block';

        // Destroy old chart if re-navigating
        if (window._monthlyChartInstance) {
          window._monthlyChartInstance.destroy();
        }

        const maxVal = Math.max(...monthCounts, 1);
        window._monthlyChartInstance = new Chart(chartEl, {
          type: 'bar',
          data: {
            labels: MONTHS_ID,
            datasets: [{
              label: 'Tamu Check-in',
              data: monthCounts,
              backgroundColor: monthCounts.map((v, i) =>
                i === mo - 1
                  ? 'rgba(5, 150, 105, 0.95)'
                  : 'rgba(16, 185, 129, 0.40)'
              ),
              borderColor: monthCounts.map((v, i) =>
                i === mo - 1
                  ? '#047857'
                  : 'transparent'
              ),
              borderWidth: 1,
              borderRadius: 6,
              borderSkipped: false,
              hoverBackgroundColor: 'rgba(5, 150, 105, 1)',
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  title: (items) => `${MONTHS_ID[items[0].dataIndex]} ${yr}`,
                  label: (item) => ` ${item.raw} tamu check-in`
                },
                backgroundColor: '#ffffff',
                titleColor: '#0f172a',
                bodyColor: '#475569',
                borderColor: '#e2e8f0',
                borderWidth: 1.5,
                padding: 10,
                cornerRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }
            },
            scales: {
              x: {
                grid: { color: 'rgba(0, 0, 0, 0.04)' },
                ticks: { color: '#64748b', font: { size: 11, weight: '500' } },
              },
              y: {
                grid: { color: 'rgba(0, 0, 0, 0.04)' },
                ticks: { color: '#64748b', font: { size: 11 }, stepSize: 1 },
                min: 0,
                suggestedMax: maxVal + 1,
              }
            }
          }
        });
      }

      // ── 4. 5 tamu terakhir check-in ──
      const recentDiv = document.getElementById('recent-guests');
      // Sort by last_checkin DESC and take 5
      const recent5 = [...allGuests]
        .filter(g => g.last_checkin)
        .sort((a, b) => (b.last_checkin || '').localeCompare(a.last_checkin || ''))
        .slice(0, 5);

      if (!recent5.length) {
        recentDiv.innerHTML = `<div class="empty-state" style="padding:1.5rem;"><div class="empty-icon">👥</div><p>Belum ada data check-in.</p></div>`;
      } else {
        recentDiv.innerHTML = recent5.map((g, idx) => `
          <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 0;${idx < recent5.length-1 ? 'border-bottom:1px solid var(--border);' : ''}cursor:pointer;" onclick="guestsPanel.showDetail(${g.id})">
            <div class="user-avatar" style="width:38px;height:38px;font-size:0.85rem;flex-shrink:0;">${getInitials(g.nama_tamu)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:0.9rem;">${escHtml(g.nama_tamu)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                ${g.last_checkin ? formatDate(g.last_checkin) : '—'}${g.last_room ? ' · Kamar <strong style="color:var(--primary);">' + escHtml(g.last_room) + '</strong>' : ''}
              </div>
            </div>
            ${identityBadge(g.jenis_identitas)}
          </div>
        `).join('');
      }

    } catch (err) {
      console.error('[Home] loadHomeStats error:', err);
    }
  },

  openCheckinModal(guestId, guestName) {
    checkinModule.openCheckinModal(guestId, guestName);
  },

  setupLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      confirmDialog('Anda yakin ingin keluar?', () => auth.logout(), { title: 'Logout', danger: true });
    });
    document.getElementById('logout-sidebar-btn')?.addEventListener('click', () => {
      confirmDialog('Anda yakin ingin keluar?', () => auth.logout(), { title: 'Logout', danger: true });
    });

    // Mobile hamburger
    document.getElementById('hamburger-btn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('show');
    });
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('show');
    });
  },

  startClock() {
    const clockEl = document.getElementById('clock-time');
    if (!clockEl) return;

    const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    const updateTime = () => {
      const now = new Date();
      const dayName = DAYS_ID[now.getDay()];
      const date = now.getDate();
      const monthName = MONTHS_ID[now.getMonth()];
      const year = now.getFullYear();
      
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      
      clockEl.textContent = `${dayName}, ${date} ${monthName} ${year} - ${hours}:${minutes}:${seconds}`;
    };

    updateTime();
    setInterval(updateTime, 1000);
  },

  newsItems: [],
  currentNewsIndex: 0,
  newsRotateTimer: null,
  isNewsHovered: false,

  async initNews() {
    const prevBtn = document.getElementById('news-prev-btn');
    const nextBtn = document.getElementById('news-next-btn');
    const allBtn = document.getElementById('news-all-btn');
    const viewport = document.getElementById('news-headline-viewport');
    const refreshBtn = document.getElementById('news-refresh-btn');

    if (prevBtn) {
      prevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.stepNews(-1);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.stepNews(1);
      });
    }
    if (allBtn) {
      allBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate('panel-news');
      });
    }
    if (viewport) {
      viewport.addEventListener('mouseenter', () => { this.isNewsHovered = true; });
      viewport.addEventListener('mouseleave', () => { this.isNewsHovered = false; });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳ Sinkronisasi...';
        await this.loadNews(true);
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Refresh Berita';
      });
    }

    // Initial load
    await this.loadNews();

    // Background refresh every 10 minutes
    setInterval(() => {
      this.loadNews(false);
    }, 10 * 60 * 1000);
  },

  async loadNews(force = false) {
    try {
      const res = await api.get('/news' + (force ? '?refresh=1' : ''));
      if (res && res.success && Array.isArray(res.news) && res.news.length > 0) {
        this.newsItems = res.news;
        if (this.currentNewsIndex >= this.newsItems.length) this.currentNewsIndex = 0;
        this.displayNewsHeadline(this.currentNewsIndex);
        this.startNewsRotator();
        if (this.currentPanel === 'panel-news') {
          this.renderNewsGrid();
        }
      }
    } catch (err) {
      console.warn('[News] Load error:', err);
    }
  },

  displayNewsHeadline(index) {
    if (!this.newsItems || this.newsItems.length === 0) return;
    const item = this.newsItems[index % this.newsItems.length];
    const sourceEl = document.getElementById('news-source-tag');
    const titleEl  = document.getElementById('news-title-text');
    const timeEl   = document.getElementById('news-time-tag');
    const linkEl   = document.getElementById('news-headline-link');

    if (sourceEl) sourceEl.textContent = (item.source || 'Tanjungpinang').toUpperCase();
    if (titleEl) {
      titleEl.style.opacity = '0';
      titleEl.style.transform = 'translateY(4px)';
      setTimeout(() => {
        titleEl.textContent = item.title;
        titleEl.style.opacity = '1';
        titleEl.style.transform = 'translateY(0)';
      }, 150);
    }
    if (timeEl) timeEl.textContent = item.timeAgo ? `• ${item.timeAgo}` : '';
    if (linkEl) {
      linkEl.href = item.link || '#';
      linkEl.title = `${item.title} (${item.source})`;
    }
  },

  stepNews(delta) {
    if (!this.newsItems || this.newsItems.length === 0) return;
    this.currentNewsIndex = (this.currentNewsIndex + delta + this.newsItems.length) % this.newsItems.length;
    this.displayNewsHeadline(this.currentNewsIndex);
  },

  startNewsRotator() {
    if (this.newsRotateTimer) clearInterval(this.newsRotateTimer);
    this.newsRotateTimer = setInterval(() => {
      if (!this.isNewsHovered && this.newsItems && this.newsItems.length > 1) {
        this.currentNewsIndex = (this.currentNewsIndex + 1) % this.newsItems.length;
        this.displayNewsHeadline(this.currentNewsIndex);
      }
    }, 7000);
  },

  initNewsPanel() {
    if (this.newsItems && this.newsItems.length > 0) {
      this.renderNewsGrid();
    } else {
      this.loadNews().then(() => this.renderNewsGrid());
    }
  },

  renderNewsGrid() {
    const container = document.getElementById('news-grid-container');
    if (!container) return;

    if (!this.newsItems || this.newsItems.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:3rem;color:var(--text-muted);grid-column:1/-1;">
          Tidak ada warta berita Tanjungpinang yang dapat ditampilkan saat ini.
        </div>
      `;
      return;
    }

    container.innerHTML = this.newsItems.map((item, idx) => `
      <div class="news-item-card">
        <div class="news-item-badge-row">
          <span class="news-item-source">${escHtml(item.source || 'Tanjungpinang')}</span>
          <span class="news-item-time">${escHtml(item.timeAgo || 'Terkini')}</span>
        </div>
        <h4 class="news-item-title">${escHtml(item.title)}</h4>
        <div class="news-item-footer">
          <span class="news-item-location">📍 Kota Tanjungpinang</span>
          <a href="${escHtml(item.link || '#')}" target="_blank" rel="noopener noreferrer" class="news-item-link">
            Buka Berita Asli ↗
          </a>
        </div>
      </div>
    `).join('');
  },

  weatherData: null,
  weatherTimer: null,

  async initWeather() {
    const refreshBtn = document.getElementById('weather-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.classList.add('rotating');
        await this.loadWeather(true);
        setTimeout(() => refreshBtn.classList.remove('rotating'), 600);
      });
    }

    // Initial weather load
    await this.loadWeather();

    // Auto-update every 5 minutes (300,000 ms)
    if (this.weatherTimer) clearInterval(this.weatherTimer);
    this.weatherTimer = setInterval(() => {
      this.loadWeather(false);
    }, 5 * 60 * 1000);
  },

  async loadWeather(force = false) {
    try {
      const res = await api.get('/weather' + (force ? '?refresh=1' : ''));
      if (res && res.success && res.weather) {
        this.weatherData = res;
        this.renderWeather(res);
      }
    } catch (err) {
      console.warn('[Weather] Load error:', err);
    }
  },

  renderWeather(data) {
    if (!data || !data.weather) return;
    const w = data.weather;
    const air = data.airQuality || {};

    // Temperature & Conditions
    const tempEl = document.getElementById('weather-temp');
    const condEl = document.getElementById('weather-condition');
    const feelsEl = document.getElementById('weather-feels');
    if (tempEl) tempEl.textContent = typeof w.temperature === 'number' ? w.temperature.toFixed(1) : w.temperature;
    if (condEl) condEl.textContent = w.condition || 'Cerah Berawan';
    if (feelsEl) {
      feelsEl.textContent = `Terasa ${w.feelsLike || w.temperature}°C • Lembap ${w.humidity || 75}%`;
    }

    // Animated weather art illustration
    const artIcon = document.getElementById('weather-art-icon');
    if (artIcon) {
      artIcon.className = `weather-art weather-art-${w.animationType || 'partly-cloudy'}`;
      artIcon.innerHTML = this.getWeatherAnimationHTML(w.animationType, w.isDay);
    }

    // High & Low
    const maxEl = document.getElementById('weather-temp-max');
    const minEl = document.getElementById('weather-temp-min');
    if (maxEl) maxEl.textContent = `${w.tempMax !== undefined ? w.tempMax : '—'}°C`;
    if (minEl) minEl.textContent = `${w.tempMin !== undefined ? w.tempMin : '—'}°C`;

    // Wind Speed & Direction
    const windSpeedEl = document.getElementById('weather-wind-speed');
    const windTextEl = document.getElementById('weather-wind-text');
    const windArrowEl = document.getElementById('weather-wind-arrow');
    if (windSpeedEl) windSpeedEl.textContent = `${w.windSpeed || '0'} km/h`;
    if (windTextEl) {
      const dir = w.windDirection || {};
      windTextEl.textContent = dir.text || `${dir.degrees || 0}° ${dir.code || 'U'}`;
    }
    if (windArrowEl && w.windDirection && typeof w.windDirection.degrees === 'number') {
      windArrowEl.style.transform = `rotate(${w.windDirection.degrees}deg)`;
    }

    // Air Quality Status (Normal - Hijau, Sedang - Oren, Waspada - Merah)
    const airPill = document.getElementById('weather-air-pill');
    const aqiValEl = document.getElementById('weather-aqi-val');
    const airDescEl = document.getElementById('weather-air-desc');
    const airCard = document.getElementById('weather-air-card');

    if (airPill) {
      airPill.className = `air-status-pill ${air.badgeClass || 'aqi-normal'}`;
      airPill.textContent = air.label || 'Normal (Baik)';
    }
    if (aqiValEl) {
      aqiValEl.textContent = `AQI: ${air.aqi || 45} • PM2.5: ${air.pm25 || 12} µg/m³`;
    }
    if (airDescEl) {
      airDescEl.textContent = air.desc || 'Kualitas udara Kota Tanjungpinang bersih dan segar.';
    }
    if (airCard) {
      airCard.className = `weather-air-card ${air.badgeClass || 'aqi-normal'}`;
    }

    // Last updated
    const lastUpdateEl = document.getElementById('weather-last-update');
    if (lastUpdateEl) {
      const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      lastUpdateEl.textContent = `Pembaruan: ${timeStr} WIB (Auto 5 mnt)`;
    }
  },

  getWeatherAnimationHTML(type, isDay = true) {
    switch (type) {
      case 'clear-day':
        return `
          <div class="art-sun-pulse"></div>
          <div class="art-sun"></div>
        `;
      case 'clear-night':
        return `
          <div class="art-moon"></div>
          <div class="art-star s1">✦</div>
          <div class="art-star s2">✦</div>
        `;
      case 'cloudy':
        return `
          <div class="art-cloud cloud-back"></div>
          <div class="art-cloud cloud-front"></div>
        `;
      case 'rain':
      case 'rain-heavy':
      case 'drizzle':
        return `
          <div class="art-cloud"></div>
          <div class="art-rain-drops">
            <span class="drop d1"></span>
            <span class="drop d2"></span>
            <span class="drop d3"></span>
          </div>
        `;
      case 'thunderstorm':
        return `
          <div class="art-cloud cloud-storm"></div>
          <div class="art-lightning">⚡</div>
          <div class="art-rain-drops">
            <span class="drop d1"></span>
            <span class="drop d2"></span>
          </div>
        `;
      case 'partly-cloudy':
      default:
        return `
          <div class="art-sun"></div>
          <div class="art-cloud"></div>
        `;
    }
  }
};

function escHtml(str) { return searchPanel.escHtml(str); }

window.addEventListener('DOMContentLoaded', () => dashboard.init());
