require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

if (!process.env.JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET não definido no .env; usando segredo padrão de desenvolvimento.');
}

// para:
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false
}));
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

// REGISTRO
app.post('/api/registro', registerLimiter, async (req, res) => {
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
    const { data, error } = await supabase
      .from('usuarios')
      .insert([{ nome: nome.trim(), email: email.toLowerCase().trim(), senha: hash }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ erro: 'Este email já está cadastrado.' });
      return res.status(500).json({ erro: 'Erro interno.' });
    }

    const token = jwt.sign(
      { id: data.id, nome: data.nome, email: data.email, role: data.role },
      SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ mensagem: 'Conta criada!', token, usuario: { id: data.id, nome: data.nome, email: data.email } });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

// LOGIN
app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha)
    return res.status(400).json({ erro: 'Informe email e senha.' });

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();

  const senhaFake = '$2a$12$invalido.hash.para.evitar.timing.attack.aqui';
  const senhaCorreta = bcrypt.compareSync(senha, usuario ? usuario.senha : senhaFake);

  if (!usuario || !senhaCorreta)
    return res.status(401).json({ erro: 'Email ou senha incorretos.' });

  const token = jwt.sign(
    { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role },
    SECRET,
    { expiresIn: '7d' }
  );
  res.json({ mensagem: 'Login realizado!', token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, role: usuario.role } });
});

// PERFIL
app.get('/api/perfil', autenticar, async (req, res) => {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, nome, email, role, criado_em')
    .eq('id', req.usuario.id)
    .single();

  if (error || !data) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json(data);
});

// CARRINHO - GET
app.get('/api/carrinho', autenticar, async (req, res) => {
  const { data } = await supabase
    .from('carrinho')
    .select('*')
    .eq('usuario_id', req.usuario.id);
  res.json(data || []);
});

// CARRINHO - ADD
app.post('/api/carrinho', autenticar, async (req, res) => {
  const { produto_id, nome, preco, quantidade, img } = req.body;
  if (!produto_id || !nome || !preco)
    return res.status(400).json({ erro: 'Dados incompletos.' });

  const qtd = parseInt(quantidade) || 1;

  const { data: existente } = await supabase
    .from('carrinho')
    .select('*')
    .eq('usuario_id', req.usuario.id)
    .eq('produto_id', String(produto_id))
    .single();

  if (existente) {
    await supabase
      .from('carrinho')
      .update({ quantidade: existente.quantidade + qtd })
      .eq('id', existente.id);
  } else {
    await supabase
      .from('carrinho')
      .insert([{ usuario_id: req.usuario.id, produto_id: String(produto_id), nome, preco, quantidade: qtd, img: img || '' }]);
  }

  const { data: carrinho } = await supabase.from('carrinho').select('*').eq('usuario_id', req.usuario.id);
  res.json({ mensagem: 'Item adicionado!', carrinho: carrinho || [] });
});

// CARRINHO - UPDATE
app.put('/api/carrinho/:id', autenticar, async (req, res) => {
  const qtd = parseInt(req.body.quantidade);
  if (!qtd || qtd < 1) return res.status(400).json({ erro: 'Quantidade inválida.' });

  const { data: item } = await supabase
    .from('carrinho')
    .select('*')
    .eq('id', req.params.id)
    .eq('usuario_id', req.usuario.id)
    .single();

  if (!item) return res.status(404).json({ erro: 'Item não encontrado.' });

  await supabase.from('carrinho').update({ quantidade: qtd }).eq('id', req.params.id);

  const { data: carrinho } = await supabase.from('carrinho').select('*').eq('usuario_id', req.usuario.id);
  res.json({ mensagem: 'Atualizado!', carrinho: carrinho || [] });
});

// CARRINHO - DELETE ITEM
app.delete('/api/carrinho/:id', autenticar, async (req, res) => {
  await supabase.from('carrinho').delete().eq('id', req.params.id).eq('usuario_id', req.usuario.id);
  const { data: carrinho } = await supabase.from('carrinho').select('*').eq('usuario_id', req.usuario.id);
  res.json({ mensagem: 'Removido!', carrinho: carrinho || [] });
});

// CARRINHO - LIMPAR
app.delete('/api/carrinho', autenticar, async (req, res) => {
  await supabase.from('carrinho').delete().eq('usuario_id', req.usuario.id);
  res.json({ mensagem: 'Carrinho limpo!', carrinho: [] });
});

// PEDIDOS - CRIAR
app.post('/api/pedidos', autenticar, async (req, res) => {
  const { data: itens } = await supabase.from('carrinho').select('*').eq('usuario_id', req.usuario.id);
  if (!itens || !itens.length) return res.status(400).json({ erro: 'Carrinho vazio.' });

  const total = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);

  const { data: pedido, error } = await supabase
    .from('pedidos')
    .insert([{ usuario_id: req.usuario.id, total }])
    .select()
    .single();

  if (error) return res.status(500).json({ erro: 'Erro ao criar pedido.' });

  const itensPedido = itens.map(i => ({
    pedido_id: pedido.id,
    produto_id: i.produto_id,
    nome: i.nome,
    preco: i.preco,
    quantidade: i.quantidade
  }));

  await supabase.from('pedido_itens').insert(itensPedido);
  await supabase.from('carrinho').delete().eq('usuario_id', req.usuario.id);

  res.status(201).json({ mensagem: 'Pedido realizado!', pedido_id: pedido.id, total });
});

// PEDIDOS - LISTAR
app.get('/api/pedidos', autenticar, async (req, res) => {
  const { data: pedidos } = await supabase
    .from('pedidos')
    .select('*')
    .eq('usuario_id', req.usuario.id)
    .order('criado_em', { ascending: false });

  if (!pedidos) return res.json([]);

  const pedidosComItens = await Promise.all(pedidos.map(async (p) => {
    const { data: itens } = await supabase.from('pedido_itens').select('*').eq('pedido_id', p.id);
    return { ...p, itens: itens || [] };
  }));

  res.json(pedidosComItens);
});

app.listen(PORT, () => {
  console.log(`\n✅ API rodando em http://localhost:${PORT}`);
  console.log(`🔒 Segurança: helmet + rate limit + bcrypt + JWT\n`);
});
