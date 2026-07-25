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

    // Navigate to default panel
    const defaultPanel = this.user.role === 'receptionist' ? 'panel-search' : 'panel-home';
    this.navigate(defaultPanel);
  },

  renderUserInfo() {
    const u = this.user;
    document.getElementById('header-user-name').textContent = u.nama;
    document.getElementById('sidebar-user-name').textContent = u.nama;
    document.getElementById('sidebar-user-role').innerHTML = roleBadge(u.role);
    document.getElementById('sidebar-user-avatar').textContent = getInitials(u.nama);
    document.getElementById('header-user-avatar').textContent = getInitials(u.nama);
  },

  renderNav() {
    const u = this.user;
    const nav = document.getElementById('sidebar-nav');

    const allItems = [
      { id: 'panel-home', icon: '🏠', label: 'Beranda', roles: ['admin', 'superadmin'] },
      { id: 'panel-search', icon: '🔍', label: 'Cari Tamu', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-checkin', icon: '➕', label: 'Check-in Baru', roles: ['receptionist', 'admin', 'superadmin'] },
      { id: 'panel-guests', icon: '📋', label: 'Semua Data Tamu', roles: ['admin', 'superadmin'] },
      { id: 'panel-users', icon: '👥', label: 'Manajemen Akun', roles: ['admin', 'superadmin'] },
      { id: 'panel-excel', icon: '📁', label: 'Upload Excel', roles: ['superadmin'] },
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
    };
    document.getElementById('main-title').textContent = titles[panelId] || '';

    // Initialize panel if first time
    if (this.currentPanel !== panelId) {
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
    }
  },

  async loadHomeStats() {
    try {
      // Guests count
      const gRes = await api.get('/guests', { page: 1, limit: 1 });
      document.getElementById('stat-total-tamu').textContent = gRes.pagination?.total || 0;

      // Today checkins
      const today = new Date().toISOString().split('T')[0];
      const sRes = await api.get('/guests/search', { q: today });
      document.getElementById('stat-today').textContent = sRes.data?.length || 0;

      // Users count
      const uRes = await api.get('/users');
      document.getElementById('stat-users').textContent = uRes.data?.length || 0;
    } catch {}

    // Recent guests (last 5)
    try {
      const res = await api.get('/guests', { page: 1, limit: 5 });
      const recentDiv = document.getElementById('recent-guests');
      const guests = res.data || [];
      if (!guests.length) {
        recentDiv.innerHTML = `<div class="empty-state" style="padding:1.5rem;"><div class="empty-icon">👥</div><p>Belum ada data tamu.</p></div>`;
        return;
      }
      recentDiv.innerHTML = guests.map(g => `
        <div style="display:flex;align-items:center;gap:0.85rem;padding:0.75rem 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="guestsPanel.showDetail(${g.id})">
          <div class="user-avatar" style="width:40px;height:40px;font-size:0.9rem;flex-shrink:0;">${getInitials(g.nama_tamu)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(g.nama_tamu)}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);">${g.last_checkin ? formatDate(g.last_checkin) : 'Belum check-in'} ${g.last_room ? '— Kamar ' + g.last_room : ''}</div>
          </div>
          ${identityBadge(g.jenis_identitas)}
        </div>
      `).join('');
    } catch {}
  },

  openCheckinModal(guestId, guestName) {
    checkinModule.openCheckinModal(guestId, guestName);
  },

  setupLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      confirmDialog('Anda yakin ingin keluar?', () => auth.logout(), { title: 'Logout', danger: false });
    });
    document.getElementById('logout-sidebar-btn')?.addEventListener('click', () => {
      confirmDialog('Anda yakin ingin keluar?', () => auth.logout(), { title: 'Logout', danger: false });
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
  }
};

function escHtml(str) { return searchPanel.escHtml(str); }

window.addEventListener('DOMContentLoaded', () => dashboard.init());
