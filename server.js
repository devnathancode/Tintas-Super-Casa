require('dotenv').config();
const express    = require('express');
const Database   = require('better-sqlite3');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const app    = express();
const PORT   = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;

if (!SECRET) {
  console.error('❌ ERRO: JWT_SECRET não definido no .env!');
  process.exit(1);
}

const db = new Database('loja.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nome       TEXT    NOT NULL,
    email      TEXT    UNIQUE NOT NULL,
    senha      TEXT    NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'cliente',
    criado_em  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS carrinho (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL,
    produto_id  TEXT    NOT NULL,
    nome        TEXT    NOT NULL,
    preco       REAL    NOT NULL,
    quantidade  INTEGER NOT NULL DEFAULT 1,
    img         TEXT,
    UNIQUE(usuario_id, produto_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS pedidos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL,
    total       REAL    NOT NULL,
    status      TEXT    NOT NULL DEFAULT 'pendente',
    criado_em   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );
  CREATE TABLE IF NOT EXISTS pedido_itens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id  INTEGER NOT NULL,
    produto_id TEXT    NOT NULL,
    nome       TEXT    NOT NULL,
    preco      REAL    NOT NULL,
    quantidade INTEGER NOT NULL,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
  );
`);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json());
app.use(express.static(path.resolve('./')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { erro: 'Muitas tentativas. Tente em 15 minutos.' }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  message: { erro: 'Muitos cadastros. Tente mais tarde.' }
});

function autenticar(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ erro: 'Token não fornecido' });
  const token = auth.split(' ')[1];
  try {
    req.usuario = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    return res.status(401).json({ erro: 'Token inválido' });
  }
}
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/api', (req, res) => {
  res.json({ status: 'ok', mensagem: 'API Tintas Super Casa rodando ✅' });
});

app.post('/api/registro', registerLimiter, (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha)
    return res.status(400).json({ erro: 'Preencha todos os campos.' });
  if (nome.trim().length < 3)
    return res.status(400).json({ erro: 'Nome deve ter ao menos 3 caracteres.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ erro: 'Email inválido.' });

  const senhaForte = senha.length >= 8 && /[A-Z]/.test(senha) && /[a-z]/.test(senha) && /[0-9]/.test(senha) && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(senha);
  if (!senhaForte)
    return res.status(400).json({ erro: 'Senha fraca. Use maiúsculas, minúsculas, números e símbolos.' });

  try {
    const hash = bcrypt.hashSync(senha, 12);
    const result = db.prepare('INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)').run(nome.trim(), email.toLowerCase().trim(), hash);
    const token = jwt.sign({ id: result.lastInsertRowid, nome: nome.trim(), email: email.toLowerCase().trim(), role: 'cliente' }, SECRET, { expiresIn: '7d' });
    res.status(201).json({ mensagem: 'Conta criada!', token, usuario: { id: result.lastInsertRowid, nome: nome.trim(), email: email.toLowerCase().trim() } });
  } catch (err) {
    if (err.message.includes('UNIQUE'))
      return res.status(409).json({ erro: 'Este email já está cadastrado.' });
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha)
    return res.status(400).json({ erro: 'Informe email e senha.' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email.toLowerCase().trim());
  const senhaFake = '$2a$12$invalido.hash.para.evitar.timing.attack.aqui';
  const senhaCorreta = bcrypt.compareSync(senha, usuario ? usuario.senha : senhaFake);

  if (!usuario || !senhaCorreta)
    return res.status(401).json({ erro: 'Email ou senha incorretos.' });

  const token = jwt.sign({ id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role }, SECRET, { expiresIn: '7d' });
  res.json({ mensagem: 'Login realizado!', token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role } });
});

app.get('/api/perfil', autenticar, (req, res) => {
  const usuario = db.prepare('SELECT id, nome, email, role, criado_em FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json(usuario);
});

app.get('/api/carrinho', autenticar, (req, res) => {
  res.json(db.prepare('SELECT * FROM carrinho WHERE usuario_id = ?').all(req.usuario.id));
});

app.post('/api/carrinho', autenticar, (req, res) => {
  const { produto_id, nome, preco, quantidade, img } = req.body;
  if (!produto_id || !nome || !preco)
    return res.status(400).json({ erro: 'Dados incompletos.' });

  const qtd = parseInt(quantidade) || 1;
  const existente = db.prepare('SELECT * FROM carrinho WHERE usuario_id = ? AND produto_id = ?').get(req.usuario.id, String(produto_id));

  if (existente) {
    db.prepare('UPDATE carrinho SET quantidade = quantidade + ? WHERE id = ?').run(qtd, existente.id);
  } else {
    db.prepare('INSERT INTO carrinho (usuario_id, produto_id, nome, preco, quantidade, img) VALUES (?, ?, ?, ?, ?, ?)').run(req.usuario.id, String(produto_id), nome, preco, qtd, img || '');
  }
  res.json({ mensagem: 'Item adicionado!', carrinho: db.prepare('SELECT * FROM carrinho WHERE usuario_id = ?').all(req.usuario.id) });
});

app.put('/api/carrinho/:id', autenticar, (req, res) => {
  const qtd = parseInt(req.body.quantidade);
  if (!qtd || qtd < 1) return res.status(400).json({ erro: 'Quantidade inválida.' });
  const item = db.prepare('SELECT * FROM carrinho WHERE id = ? AND usuario_id = ?').get(req.params.id, req.usuario.id);
  if (!item) return res.status(404).json({ erro: 'Item não encontrado.' });
  db.prepare('UPDATE carrinho SET quantidade = ? WHERE id = ? AND usuario_id = ?').run(qtd, req.params.id, req.usuario.id);
  res.json({ mensagem: 'Atualizado!', carrinho: db.prepare('SELECT * FROM carrinho WHERE usuario_id = ?').all(req.usuario.id) });
});

app.delete('/api/carrinho/:id', autenticar, (req, res) => {
  db.prepare('DELETE FROM carrinho WHERE id = ? AND usuario_id = ?').run(req.params.id, req.usuario.id);
  res.json({ mensagem: 'Removido!', carrinho: db.prepare('SELECT * FROM carrinho WHERE usuario_id = ?').all(req.usuario.id) });
});

app.delete('/api/carrinho', autenticar, (req, res) => {
  db.prepare('DELETE FROM carrinho WHERE usuario_id = ?').run(req.usuario.id);
  res.json({ mensagem: 'Carrinho limpo!', carrinho: [] });
});

app.post('/api/pedidos', autenticar, (req, res) => {
  const itens = db.prepare('SELECT * FROM carrinho WHERE usuario_id = ?').all(req.usuario.id);
  if (!itens.length) return res.status(400).json({ erro: 'Carrinho vazio.' });
  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const pedido = db.prepare('INSERT INTO pedidos (usuario_id, total) VALUES (?, ?)').run(req.usuario.id, total);
  const insertItem = db.prepare('INSERT INTO pedido_itens (pedido_id, produto_id, nome, preco, quantidade) VALUES (?, ?, ?, ?, ?)');
  itens.forEach(i => insertItem.run(pedido.lastInsertRowid, i.produto_id, i.nome, i.preco, i.quantidade));
  db.prepare('DELETE FROM carrinho WHERE usuario_id = ?').run(req.usuario.id);
  res.status(201).json({ mensagem: 'Pedido realizado!', pedido_id: pedido.lastInsertRowid, total });
});

app.get('/api/pedidos', autenticar, (req, res) => {
  const pedidos = db.prepare('SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY criado_em DESC').all(req.usuario.id);
  res.json(pedidos.map(p => ({ ...p, itens: db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(p.id) })));
});

app.listen(PORT, () => {
  console.log(`\n✅ API rodando em http://localhost:${PORT}`);
  console.log(`🔒 Segurança: helmet + rate limit + bcrypt + JWT\n`);
});
