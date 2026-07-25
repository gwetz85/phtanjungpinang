/**
 * User Management Panel (Admin+)
 */

const usersPanel = (() => {
  function init() {
    loadUsers();
    document.getElementById('add-user-btn')?.addEventListener('click', openAddModal);
  }

  async function loadUsers() {
    const grid = document.getElementById('users-grid');
    if (!grid) return;
    grid.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);"><div class="spinner" style="margin:0 auto;"></div></div>`;

    try {
      const res = await api.get('/users');
      const users = res.data || [];
      const currentUser = auth.getUser();

      if (!users.length) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>Belum ada user.</p></div>`;
        return;
      }

      grid.innerHTML = users.map(u => `
        <div class="card" style="transition:all var(--transition);" onmouseover="this.style.borderColor='var(--border-focus)'" onmouseout="this.style.borderColor='var(--border)'">
          <div class="card-body" style="display:flex;align-items:center;gap:1rem;">
            <div class="user-avatar" style="width:48px;height:48px;font-size:1.1rem;flex-shrink:0;">${getInitials(u.nama)}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(u.nama)}</div>
              <div style="font-size:0.82rem;color:var(--text-secondary);">@${escHtml(u.username)}</div>
              <div style="margin-top:0.35rem;">${roleBadge(u.role)}</div>
            </div>
            <div style="display:flex;flex-direction:column;gap:0.4rem;flex-shrink:0;">
              <button class="btn btn-warning btn-sm" onclick="usersPanel.editUser(${u.id})">✏️ Edit</button>
              ${u.id !== currentUser?.id ? `<button class="btn btn-danger btn-sm" onclick="usersPanel.deleteUser(${u.id}, '${escHtml(u.nama)}')">🗑️ Hapus</button>` : `<span style="font-size:0.72rem;color:var(--text-muted);text-align:center;">Akun Anda</span>`}
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      grid.innerHTML = `<div class="alert alert-error"><span>❌</span><span>${err.message}</span></div>`;
    }
  }

  function openAddModal() {
    createModal({
      id: 'add-user-modal',
      title: '➕ Tambah User Baru',
      body: `
        <form id="add-user-form">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="au-nama">Nama Lengkap</label>
              <input type="text" id="au-nama" class="form-control" placeholder="Nama lengkap" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="au-username">Username</label>
              <input type="text" id="au-username" class="form-control" placeholder="username" required autocomplete="off">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="au-password">Password</label>
              <input type="password" id="au-password" class="form-control" placeholder="Min 6 karakter" required autocomplete="new-password">
            </div>
            <div class="form-group">
              <label class="form-label" for="au-role">Role</label>
              <select id="au-role" class="form-control" required>
                <option value="">Pilih Role</option>
                <option value="receptionist">Receptionist</option>
                <option value="admin">Admin</option>
                <option value="superadmin">Super Admin</option>
              </select>
            </div>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn-secondary" onclick="document.getElementById('add-user-modal').remove()">Batal</button>
        <button class="btn btn-primary" id="add-user-save">💾 Tambahkan</button>
      `
    });

    document.getElementById('add-user-save').addEventListener('click', async () => {
      const body = {
        nama: document.getElementById('au-nama').value.trim(),
        username: document.getElementById('au-username').value.trim(),
        password: document.getElementById('au-password').value,
        role: document.getElementById('au-role').value
      };
      if (!body.nama || !body.username || !body.password || !body.role) {
        toast('Semua field wajib diisi!', 'warning'); return;
      }
      if (body.password.length < 6) {
        toast('Password minimal 6 karakter!', 'warning'); return;
      }
      try {
        const res = await api.post('/users', body);
        toast(res.message, 'success');
        document.getElementById('add-user-modal').remove();
        loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function editUser(userId) {
    try {
      const res = await api.get('/users');
      const user = res.data.find(u => u.id === userId);
      if (!user) { toast('User tidak ditemukan', 'error'); return; }

      createModal({
        id: 'edit-user-modal',
        title: `✏️ Edit User: ${escHtml(user.nama)}`,
        body: `
          <form id="edit-user-form">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="eu-nama">Nama Lengkap</label>
                <input type="text" id="eu-nama" class="form-control" value="${escHtml(user.nama)}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Username</label>
                <input class="form-control" value="${escHtml(user.username)}" disabled style="opacity:0.6;">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="eu-password">Password Baru <span style="font-size:0.75rem;color:var(--text-muted)">(kosongkan jika tidak diubah)</span></label>
                <input type="password" id="eu-password" class="form-control" placeholder="Password baru..." autocomplete="new-password">
              </div>
              <div class="form-group">
                <label class="form-label" for="eu-role">Role</label>
                <select id="eu-role" class="form-control" required>
                  <option value="receptionist" ${user.role === 'receptionist' ? 'selected' : ''}>Receptionist</option>
                  <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                  <option value="superadmin" ${user.role === 'superadmin' ? 'selected' : ''}>Super Admin</option>
                </select>
              </div>
            </div>
          </form>
        `,
        footer: `
          <button class="btn btn-secondary" onclick="document.getElementById('edit-user-modal').remove()">Batal</button>
          <button class="btn btn-primary" id="edit-user-save">💾 Simpan</button>
        `
      });

      document.getElementById('edit-user-save').addEventListener('click', async () => {
        const body = {
          nama: document.getElementById('eu-nama').value.trim(),
          role: document.getElementById('eu-role').value,
          password: document.getElementById('eu-password').value
        };
        try {
          await api.put(`/users/${userId}`, body);
          toast('User berhasil diperbarui!', 'success');
          document.getElementById('edit-user-modal').remove();
          loadUsers();
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) { toast(err.message, 'error'); }
  }

  function deleteUser(userId, nama) {
    confirmDialog(
      `Anda yakin ingin menghapus user <strong>${escHtml(nama)}</strong>?`,
      async () => {
        try {
          await api.del(`/users/${userId}`);
          toast('User berhasil dihapus.', 'success');
          loadUsers();
        } catch (err) { toast(err.message, 'error'); }
      }
    );
  }

  function escHtml(str) { return searchPanel.escHtml(str); }

  return { init, loadUsers, editUser, deleteUser };
})();
