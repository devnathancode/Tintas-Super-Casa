const API = 'http://localhost:3000/api';

function getToken() {
  return localStorage.getItem('tsc_token') || null;
}

function getSession() {
  try { return JSON.parse(localStorage.getItem('tsc_session') || 'null'); } catch { return null; }
}

function salvarSessao(token, usuario) {
  localStorage.setItem('tsc_token', token);
  localStorage.setItem('tsc_session', JSON.stringify({
    name:  usuario.nome,
    email: usuario.email,
    role:  usuario.role || 'cliente',
    guest: false,
    ts:    Date.now()
  }));
}

function limparSessao() {
  localStorage.removeItem('tsc_token');
  localStorage.removeItem('tsc_session');
  localStorage.removeItem('tsc_cart');
}

function isLoggedIn() {
  const s = getSession();
  return s && !s.guest && !!getToken();
}

async function apiRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API + endpoint, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    limparSessao();
    showToastGlobal('⚠️ Sessão expirada. Faça login novamente.', 'error');
    setTimeout(() => { window.location.href = 'login.html'; }, 2000);
    throw new Error('Sessão expirada');
  }

  if (!res.ok) throw new Error(data.erro || 'Erro na requisição');
  return data;
}

const Cart = {
  async load() {
    if (!isLoggedIn()) return JSON.parse(localStorage.getItem('tsc_cart') || '[]');
    try { return await apiRequest('/carrinho'); } catch { return []; }
  },

  async add(produto) {
    if (!isLoggedIn()) {
      let cart = JSON.parse(localStorage.getItem('tsc_cart') || '[]');
      const ex = cart.find(i => i.id == produto.id);
      if (ex) ex.qty = (ex.qty || 1) + 1;
      else cart.push({ ...produto, qty: 1 });
      localStorage.setItem('tsc_cart', JSON.stringify(cart));
      return cart;
    }
    const data = await apiRequest('/carrinho', {
      method: 'POST',
      body: JSON.stringify({
        produto_id: produto.id,
        nome:       produto.name || produto.nome,
        preco:      produto.price || produto.preco,
        quantidade: 1,
        img:        produto.img || ''
      })
    });
    return data.carrinho;
  },

  async updateQty(itemId, quantidade) {
    if (!isLoggedIn()) {
      let cart = JSON.parse(localStorage.getItem('tsc_cart') || '[]');
      const item = cart.find(i => i.id == itemId);
      if (item) { item.qty = quantidade; if (item.qty <= 0) cart = cart.filter(i => i.id != itemId); }
      localStorage.setItem('tsc_cart', JSON.stringify(cart));
      return cart;
    }
    if (quantidade <= 0) return this.remove(itemId);
    const data = await apiRequest('/carrinho/' + itemId, {
      method: 'PUT',
      body: JSON.stringify({ quantidade })
    });
    return data.carrinho;
  },

  async remove(itemId) {
    if (!isLoggedIn()) {
      let cart = JSON.parse(localStorage.getItem('tsc_cart') || '[]');
      cart = cart.filter(i => i.id != itemId);
      localStorage.setItem('tsc_cart', JSON.stringify(cart));
      return cart;
    }
    const data = await apiRequest('/carrinho/' + itemId, { method: 'DELETE' });
    return data.carrinho;
  },

  async clear() {
    if (!isLoggedIn()) { localStorage.removeItem('tsc_cart'); return []; }
    const data = await apiRequest('/carrinho', { method: 'DELETE' });
    return data.carrinho;
  },

  normalize(item) {
    return {
      ...item,
      id:        item.produto_id || item.id,
      name:      item.nome       || item.name,
      price:     item.preco      || item.price,
      qty:       item.quantidade || item.qty || 1,
      img:       item.img        || ''
    };
  }
};

if (typeof window !== 'undefined') {
  window._cartData = [];

  async function initCart() {
    window._cartData = (await Cart.load()).map(Cart.normalize);
    if (typeof updateCartUI === 'function') updateCartUI();
    if (typeof renderCartItems === 'function') renderCartItems();
  }

  window.saveCart = function() {};

  Object.defineProperty(window, 'cart', {
    get: () => window._cartData,
    set: (v) => { window._cartData = v; }
  });

  window.addToCart = async function(id, skipModal = false) {
    if (!skipModal) {
      if (typeof openCepModal === 'function') openCepModal(id);
      return;
    }
    // Allow adding to cart for guests — `Cart.add` already persists to localStorage when not logged in
    const produto = (window.products || []).find(p => p.id === id);
    if (!produto) return;
    try {
      window._cartData = (await Cart.add(produto)).map(Cart.normalize);
      if (typeof updateCartUI === 'function') updateCartUI();
      if (typeof renderCartItems === 'function') renderCartItems();
      showToastGlobal('✅ ' + produto.name + ' adicionado!', 'success');
    } catch (err) {
      showToastGlobal('❌ Erro ao adicionar: ' + err.message, 'error');
    }
  };

  window.removeFromCart = async function(id) {
    const item = window._cartData.find(i => i.produto_id == id || i.id == id);
    if (!item) return;
    try {
      window._cartData = (await Cart.remove(item._dbId || item.id)).map(Cart.normalize);
      if (typeof updateCartUI === 'function') updateCartUI();
      if (typeof renderCartItems === 'function') renderCartItems();
    } catch { showToastGlobal('❌ Erro ao remover item.', 'error'); }
  };

  window.changeQty = async function(id, delta) {
    const item = window._cartData.find(i => i.produto_id == id || i.id == id);
    if (!item) return;
    try {
      window._cartData = (await Cart.updateQty(item._dbId || item.id, (item.qty || 1) + delta)).map(Cart.normalize);
      if (typeof updateCartUI === 'function') updateCartUI();
      if (typeof renderCartItems === 'function') renderCartItems();
    } catch { showToastGlobal('❌ Erro ao atualizar quantidade.', 'error'); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    initCart();
    updateProfileHeader();
  });
}

function updateProfileHeader() {
  const session = getSession();
  const label   = document.getElementById('profile-label');
  const btn     = document.getElementById('profile-menu-btn');
  const menu    = document.getElementById('profile-menu');
  if (!btn) return;

  if (!session || session.guest) {
    if (label) label.textContent = 'Entrar';
    if (menu)  { menu.style.display = 'none'; menu.classList.remove('open'); }
    btn.onclick = () => { window.location.href = 'login.html'; };
  } else {
    if (label) label.textContent = session.name.split(' ')[0] || 'Perfil';
    if (menu)  menu.style.display = 'block';
    btn.onclick = toggleProfileMenu;
  }
}

function toggleProfileMenu() {
  const menu = document.getElementById('profile-menu');
  if (menu) menu.classList.toggle('open');
}

function doLogout() {
  limparSessao();
  window.location.href = 'index.html';
}

function switchAccount() {
  limparSessao();
  window.location.href = 'login.html';
}

function showToastGlobal(msg, type = '') {
  if (typeof showToast === 'function') { showToast(msg, type); return; }
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:9px;align-items:center;pointer-events:none';
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.style.cssText = 'background:#0D47A1;color:#fff;padding:11px 22px;border-radius:50px;font-size:.86rem;font-weight:600;box-shadow:0 8px 40px rgba(13,71,161,.18);display:flex;align-items:center;gap:9px;border-left:4px solid #FFC107;pointer-events:all;font-family:Poppins,sans-serif';
  if (type === 'success') t.style.background = '#1B5E20';
  if (type === 'error')   t.style.background = '#B71C1C';
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}