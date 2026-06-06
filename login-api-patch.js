const API_BASE = 'http://localhost:3000/api';

window.doLogin = async function() {
  clearErrors();
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-password').value;
  let ok = true;

  if (!email) { showErr('err-login-email', 'Informe seu email'); ok = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('err-login-email', 'Email inválido'); ok = false; }
  if (!pw) { showErr('err-login-pw', 'Informe sua senha'); ok = false; }
  if (!ok) return;

  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin-custom"></i> Verificando...';

  try {
    const res  = await fetch(API_BASE + '/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, senha: pw })
    });
    const data = await res.json();

    if (!res.ok) {
      setAlert('login-alert', 'error', data.erro || 'Email ou senha incorretos.');
      return;
    }

    localStorage.setItem('tsc_token', data.token);
    localStorage.setItem('tsc_session', JSON.stringify({
      name:  data.usuario.nome,
      email: data.usuario.email,
      role:  data.usuario.role,
      guest: false,
      ts:    Date.now()
    }));

    if (document.getElementById('remember-me').checked) {
      localStorage.setItem('tsc_remember', email);
    }

    showToast('✅ Bem-vindo, ' + data.usuario.nome.split(' ')[0] + '!', 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 1500);

  } catch (err) {
    setAlert('login-alert', 'error', '❌ Erro ao conectar com o servidor. A API está rodando?');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar';
  }
};

window.doRegister = async function() {
  clearErrors();
  const nome  = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pw    = document.getElementById('reg-password').value;
  const pw2   = document.getElementById('reg-password2').value;
  const terms = document.getElementById('terms-check').checked;
  let ok = true;

  if (!nome || nome.length < 3) { showErr('err-reg-name', 'Nome deve ter ao menos 3 caracteres'); ok = false; }
  if (!email) { showErr('err-reg-email', 'Informe um email válido'); ok = false; }
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('err-reg-email', 'Email inválido'); ok = false; }
  if (!pw) { showErr('err-reg-pw', 'Crie uma senha'); ok = false; }
  else if (!isStrongPassword(pw)) { showErr('err-reg-pw', 'A senha não atende todos os requisitos'); ok = false; }
  if (pw && pw2 !== pw) { showErr('err-reg-pw2', 'As senhas não coincidem'); ok = false; }
  if (!terms) { setAlert('register-alert', 'error', 'Aceite os termos para continuar.'); ok = false; }
  if (!ok) return;

  const btn = document.getElementById('btn-register');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-circle-notch fa-spin-custom"></i> Criando conta...';

  try {
    const res  = await fetch(API_BASE + '/registro', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nome, email, senha: pw })
    });
    const data = await res.json();

    if (!res.ok) {
      setAlert('register-alert', 'error', data.erro || 'Erro ao criar conta.');
      return;
    }

    localStorage.setItem('tsc_token', data.token);
    localStorage.setItem('tsc_session', JSON.stringify({
      name:  data.usuario.nome,
      email: data.usuario.email,
      role:  data.usuario.role,
      guest: false,
      ts:    Date.now()
    }));

    showToast('🎉 Conta criada! Bem-vindo, ' + data.usuario.nome.split(' ')[0] + '!', 'success');
    setTimeout(() => { window.location.href = 'index.html'; }, 1600);

  } catch (err) {
    setAlert('register-alert', 'error', '❌ Erro ao conectar com o servidor. A API está rodando?');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-user-plus"></i> Criar Conta';
  }
};

window.doLogout = function() {
  localStorage.removeItem('tsc_token');
  localStorage.removeItem('tsc_session');
  localStorage.removeItem('tsc_cart');
  window.location.href = 'index.html';
};