/**
 * API utility — wraps fetch with base URL, JWT token, and error handling
 */
const api = (() => {
  const BASE = '/api';

  function getToken() {
    return localStorage.getItem('token');
  }

  function buildHeaders(extra = {}) {
    const headers = { 'Content-Type': 'application/json', ...extra };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async function handleResponse(res) {
    const data = await res.json().catch(() => ({ message: 'Server error' }));
    if (!res.ok) {
      if (res.status === 401) {
        // Token expired — redirect to login
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/index.html';
        return;
      }
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    return data;
  }

  async function get(path, params = {}) {
    const url = new URL(BASE + path, window.location.origin);
    Object.entries(params).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { headers: buildHeaders() });
    return handleResponse(res);
  }

  async function post(path, body = {}) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body)
    });
    return handleResponse(res);
  }

  async function put(path, body = {}) {
    const res = await fetch(BASE + path, {
      method: 'PUT',
      headers: buildHeaders(),
      body: JSON.stringify(body)
    });
    return handleResponse(res);
  }

  async function del(path) {
    const res = await fetch(BASE + path, {
      method: 'DELETE',
      headers: buildHeaders()
    });
    return handleResponse(res);
  }

  async function upload(path, formData) {
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers,
      body: formData
    });
    return handleResponse(res);
  }

  async function download(path) {
    const token = getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(BASE + path, { headers });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Download gagal');
    }
    return res;
  }

  return { get, post, put, del, upload, download };
})();
