const express = require('express');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(helmet());
app.use(cors());

const SECRET = process.env.JWT_SECRET || 'supersecretkey';
const USERS = { admin: 'password123' };

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    const token = jwt.sign({ username }, SECRET, { expiresIn: '1h' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer '))
    return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.split(' ')[1], SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/items', authMiddleware, (req, res) => {
  res.json({ items: ['Item A', 'Item B', 'Item C'], user: req.user.username });
});

app.listen(3000, () => console.log('Server running on port 3000'));