import fs from 'node:fs';
import path from 'node:path';
import { sendJson, sendText, readBody, writeJsonAtomic } from '../lib/http.js';

export function defaultUserState() {
  return {
    leftPanelOpen: true,
    rightPanelOpen: true,
    rightPanelPinned: false,
    rightPanelTab: 'notepad',
    navCollapsed: false,
    notepadText: '',
    todoItems: [],
    surfaceMediaV1: { surfaces: {} },
    surfaceStyleV1: { surfaces: {} },
    sectionIntroV1: { sections: {} },
    dashboardV1: { blocks: [] },
    sessionV1: { blocks: [] },
    // Party Drawer global miniapp (v1)
    partyDrawerV1: {
      open: false,
      pinnedPageIds: [],
      heightVh: 55,
    },
  };
}

export function ensureUserDirs(ctx) {
  fs.mkdirSync(ctx.USER_DIR, { recursive: true });
  const userStatePath = path.join(ctx.USER_DIR, 'state.json');
  if (!fs.existsSync(userStatePath)) {
    writeJsonAtomic(userStatePath, defaultUserState());
  }
}

export function routeUserState(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // Special endpoint for custom user CSS
  if (pathname === '/user/custom.css' && req.method === 'GET') {
    const p = path.join(ctx.USER_DIR, 'custom.css');
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      fs.createReadStream(p).pipe(res);
      return true;
    }
    sendText(res, 200, '/* user css */', { 'Content-Type': 'text/css; charset=utf-8' });
    return true;
  }

  if (pathname === '/api/user/state' && req.method === 'GET') {
    const p = path.join(ctx.USER_DIR, 'state.json');
    let state = null;
    try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    sendJson(res, 200, state ?? defaultUserState());
    return true;
  }

  if (pathname === '/api/user/state' && req.method === 'PUT') {
    return (async () => {
      const patchRaw = await readBody(req);
      let patch = {};
      try { patch = JSON.parse(patchRaw || '{}'); } catch {}
      const p = path.join(ctx.USER_DIR, 'state.json');
      let current = null;
      try { current = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      const next = { ...(current || defaultUserState()), ...patch };
      writeJsonAtomic(p, next);
      sendJson(res, 200, next);
      return true;
    })();
  }

  return false;
}
