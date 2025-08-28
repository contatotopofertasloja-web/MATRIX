// index.js (raiz)
import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

app.get('/', (_req, res) => {
  res.send('Matrix Cláudia 2.0 online');
});

app.post('/ping', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`[HTTP] Running on ${port}`));
