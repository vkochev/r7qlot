import http from 'node:http';

function augmentResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  res.send = (body) => {
    if (typeof body === 'object') return res.json(body);
    res.end(String(body));
  };
  res.set = (name, value) => {
    res.setHeader(name, value);
    return res;
  };
  return res;
}

function matchPath(route, path) {
  return route === path;
}

function express() {
  const middlewares = [];
  const routes = [];

  const app = (req, res) => {
    augmentResponse(res);
    let idx = 0;
    const runMiddleware = () => {
      if (idx >= middlewares.length) return runRoute();
      const mw = middlewares[idx++];
      mw(req, res, runMiddleware);
    };
    const runRoute = () => {
      const route = routes.find((r) => r.method === req.method && matchPath(r.path, req.url));
      if (!route) return res.status(404).json({ error: 'not found' });
      return route.handler(req, res);
    };
    runMiddleware();
  };

  app.use = (mw) => middlewares.push(mw);
  app.get = (path, handler) => routes.push({ method: 'GET', path, handler });
  app.post = (path, handler) => routes.push({ method: 'POST', path, handler });
  app.listen = (port, host, cb) => http.createServer(app).listen(port, host, cb);

  return app;
}

express.json = () => async (req, _res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method || '')) return next();
  const ct = req.headers['content-type'] || '';
  if (!String(ct).includes('application/json')) return next();
  let data = '';
  for await (const chunk of req) data += chunk.toString('utf8');
  req.body = data ? JSON.parse(data) : {};
  next();
};

export default express;
