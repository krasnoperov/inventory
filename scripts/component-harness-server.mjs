import express from 'express';
import path from 'node:path';

const HOST = process.env.HARNESS_HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.HARNESS_PORT ?? '4175', 10);
const ROOT = path.resolve(process.cwd(), 'dist/component-harness');

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api', (req, res) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.status(404).type('text/plain').send('Not found');
    return;
  }

  res.status(501).type('text/plain').send('Unsupported method');
});

app.use(express.static(ROOT, {
  etag: false,
  extensions: false,
  fallthrough: false,
  lastModified: false,
  redirect: false,
}));

app.use((_req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Component harness server listening on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} on ${HOST} is already in use.`);
    console.error(`Kill it with: lsof -ti:${PORT} | xargs -r kill -9`);
    console.error('Or use a different port: HARNESS_PORT=4176 pnpm test:components');
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
