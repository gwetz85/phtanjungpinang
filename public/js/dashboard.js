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
    this.loadRunningText();
    // Poll for running text updates every 30 seconds
    setInterval(() => this.loadRunningText(), 30000);
    this.startClock();
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
    const headerAvatar = document.getElementById('header-user-avatar');
    if (headerName) headerName.textContent = u.nama;
    if (headerAvatar) headerAvatar.innerHTML = '👤';

    const sidebarName = document.getElementById('sidebar-user-name');
    const sidebarRole = document.getElementById('sidebar-user-role');
    const sidebarAvatar = document.getElementById('sidebar-user-avatar');
    if (sidebarName) sidebarName.textContent = u.nama;
    if (sidebarRole) sidebarRole.innerHTML = roleBadge(u.role);
    if (sidebarAvatar) sidebarAvatar.textContent = getInitials(u.nama);
  },

  renderNav() {
    const u = this.user;
    const nav = document.getElementById('sidebar-nav');

    const allItems = [
      { id: 'panel-home', icon: '🏠', label: 'Beranda', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-search', icon: '🔍', label: 'Cari Tamu', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-checkin', icon: '➕', label: 'Check-in Baru', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-guests', icon: '📋', label: 'Semua Data Tamu', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-users', icon: '👥', label: 'Manajemen Akun', roles: ['admin', 'superadmin'] },
      { id: 'panel-excel', icon: '📁', label: 'Upload Excel', roles: ['superadmin'] },
      { id: 'panel-running-text', icon: '📢', label: 'Running Teks', roles: ['superadmin'] },
    ];

    nav.innerHTML = allItems
      .filter(item => item.roles.includes(u.role))
      .map(item => `
        <button class="nav-item" id="nav-${item.id}" onclick="dashboard.navigate('${item.id}')">
          <span class="nav-icon">${item.icon}</span>
          ${item.label}
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
      'panel-users': '👥 Manajemen Akun',
      'panel-excel': '📁 Upload Database Excel',
      'panel-running-text': '📢 Atur Running Teks',
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
      case 'panel-users':   usersPanel.init(); break;
      case 'panel-excel':   excelPanel.init(); break;
      case 'panel-running-text': this.initRunningTextPanel(); break;
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
                  ? 'rgba(79,142,247,0.9)'
                  : 'rgba(79,142,247,0.35)'
              ),
              borderRadius: 8,
              borderSkipped: false,
              hoverBackgroundColor: 'rgba(79,142,247,0.95)',
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
                backgroundColor: 'rgba(15,20,40,0.92)',
                titleColor: '#e2e8f0',
                bodyColor: '#94a3b8',
                borderColor: 'rgba(79,142,247,0.4)',
                borderWidth: 1,
                padding: 10,
                cornerRadius: 8,
              }
            },
            scales: {
              x: {
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { color: '#94a3b8', font: { size: 11 } },
              },
              y: {
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { color: '#94a3b8', font: { size: 11 }, stepSize: 1 },
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

  formatRunningTextHTML(text) {
    if (!text) return '';
    // Split by "|" if multiple segments, or keep text intact
    const parts = text.split('|').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    
    // Create segment spans with safe encoding
    const segments = parts.map(part => {
      const safe = part
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span class="ticker-item-text">${safe}</span>`;
    });
    
    let html = segments.join('<span class="ticker-sep">✦</span>');
    // Ensure one stream is long enough for seamless infinite scroll (>= 120 chars)
    const totalChars = parts.join(' ').length;
    if (totalChars < 120) {
      const repeatCount = Math.ceil(150 / Math.max(totalChars, 10));
      const repeated = [];
      for (let i = 0; i < repeatCount; i++) {
        repeated.push(html);
      }
      html = repeated.join('<span class="ticker-sep">✦</span>');
    }
    return html + '<span class="ticker-sep">✦</span>';
  },

  async loadRunningText(force = false) {
    const banner = document.getElementById('running-text-banner');
    const wrap   = document.getElementById('running-text-wrap');
    const c1     = document.getElementById('running-text-content-1');
    const c2     = document.getElementById('running-text-content-2');
    if (!banner || !wrap || !c1 || !c2) return;

    const applyData = (text, speed = 'slow') => {
      const cleanText = (text || '').trim();
      if (!cleanText) {
        banner.style.display = 'none';
        this._lastRunningText = '';
        return;
      }

      // Check if unchanged to prevent animation stuttering on polling
      if (!force && this._lastRunningText === cleanText && this._lastRunningSpeed === speed) {
        return;
      }

      this._lastRunningText = cleanText;
      this._lastRunningSpeed = speed;

      const html = this.formatRunningTextHTML(cleanText);
      c1.innerHTML = html;
      c2.innerHTML = html;

      banner.style.display = 'flex';

      // Calculate smooth velocity-based animation duration
      requestAnimationFrame(() => {
        const singleWidth = c1.offsetWidth || (cleanText.length * 8.5);
        const speedPx = speed === 'fast' ? 70 : (speed === 'normal' ? 48 : 32);
        const duration = Math.max(20, Math.round(singleWidth / speedPx)) + 's';
        wrap.style.animationDuration = duration;
      });

      try {
        localStorage.setItem('ph_running_text', cleanText);
        localStorage.setItem('ph_running_speed', speed);
      } catch (_) {}
    };

    try {
      const res = await api.get('/settings/running-text');
      applyData(res.runningText || '', res.runningTextSpeed || 'slow');
    } catch (err) {
      try {
        const cachedText = localStorage.getItem('ph_running_text');
        const cachedSpeed = localStorage.getItem('ph_running_speed') || 'slow';
        applyData(cachedText || '', cachedSpeed);
      } catch (_) {}
      console.warn('[RunningText] API error, using cache:', err);
    }
  },

  async initRunningTextPanel() {
    const txtArea = document.getElementById('rt-content');
    const saveBtn = document.getElementById('rt-save-btn');
    if (!txtArea || !saveBtn) return;

    const speedCards = document.querySelectorAll('.rt-speed-card');
    const previewWrap = document.getElementById('rt-preview-wrap');
    const prevC1 = document.getElementById('rt-preview-content-1');
    const prevC2 = document.getElementById('rt-preview-content-2');
    const previewBadge = document.getElementById('rt-preview-speed-badge');

    const getSelectedSpeed = () => {
      const checked = document.querySelector('input[name="rt_speed"]:checked');
      return checked ? checked.value : 'slow';
    };

    const updateSpeedUI = (speedVal) => {
      speedCards.forEach(card => {
        const input = card.querySelector('input');
        if (input) {
          const isMatch = input.value === speedVal;
          input.checked = isMatch;
          card.classList.toggle('active', isMatch);
        }
      });
      if (previewBadge) {
        const labels = {
          slow: 'Pelan (~32 px/dtk)',
          normal: 'Sedang (~48 px/dtk)',
          fast: 'Cepat (~70 px/dtk)'
        };
        previewBadge.textContent = labels[speedVal] || labels.slow;
      }
      updatePreview();
    };

    const updatePreview = () => {
      if (!prevC1 || !prevC2 || !previewWrap) return;
      const val = (txtArea.value || '').trim() || 'Contoh Running Teks Hotel Pelangi Tanjungpinang...';
      const html = this.formatRunningTextHTML(val);
      prevC1.innerHTML = html;
      prevC2.innerHTML = html;

      const speed = getSelectedSpeed();
      requestAnimationFrame(() => {
        const singleWidth = prevC1.offsetWidth || (val.length * 8.5);
        const speedPx = speed === 'fast' ? 70 : (speed === 'normal' ? 48 : 32);
        const duration = Math.max(15, Math.round(singleWidth / speedPx)) + 's';
        previewWrap.style.animationDuration = duration;
      });
    };

    // Load current value from server
    try {
      const res = await api.get('/settings/running-text');
      txtArea.value = res.runningText || '';
      updateSpeedUI(res.runningTextSpeed || 'slow');
    } catch (err) {
      toast(err.message, 'error');
    }

    // Bind speed card click events
    speedCards.forEach(card => {
      card.addEventListener('click', () => {
        const input = card.querySelector('input');
        if (input) {
          updateSpeedUI(input.value);
        }
      });
    });

    // Bind quick icon buttons
    document.querySelectorAll('.rt-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const insertText = btn.getAttribute('data-insert');
        if (!insertText) return;

        const start = txtArea.selectionStart;
        const end = txtArea.selectionEnd;
        const text = txtArea.value;

        // Insert text at cursor
        txtArea.value = text.substring(0, start) + insertText + text.substring(end);
        txtArea.focus();
        txtArea.selectionStart = txtArea.selectionEnd = start + insertText.length;

        updatePreview();
      });
    });

    // Real-time preview on input
    txtArea.addEventListener('input', () => updatePreview());

    // Set save handler
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

    newSaveBtn.addEventListener('click', async () => {
      const val = txtArea.value.trim();
      const speed = getSelectedSpeed();
      try {
        newSaveBtn.disabled = true;
        newSaveBtn.textContent = '⏳ Menyimpan...';
        await api.put('/settings/running-text', { runningText: val, speed });
        toast('Running teks dan kecepatan berhasil diperbarui!', 'success');
        this.loadRunningText(true); // Force reload banner
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        newSaveBtn.disabled = false;
        newSaveBtn.textContent = '💾 Simpan & Terapkan';
      }
    });

    updatePreview();
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
  }
};

function escHtml(str) { return searchPanel.escHtml(str); }

window.addEventListener('DOMContentLoaded', () => dashboard.init());
