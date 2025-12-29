import { sendJson, readBody, decodePathParam, writeJsonAtomic } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';

export function routeBlocks(req, res, ctx) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  // POST /api/pages/:id/blocks (create block for page)
  const pageBlocksMatch = pathname.match(/^\/api\/pages\/([^\/]+)\/blocks$/);
  if (pageBlocksMatch && req.method === 'POST') {
    return (async () => {
      const pageId = decodePathParam(pageBlocksMatch[1]);
      // Virtual Section Intro page blocks
      const secMatch = pageId.match(/^section:(.+)$/);
      if (secMatch) {
        const key = secMatch[1];
        const bodyRaw = await readBody(req);
        let body = {};
        try { body = JSON.parse(bodyRaw || '{}'); } catch {}
        const { type, parentId = null, sort = 0, props = {}, content = {} } = body;
        if (!type) { badRequest(res, 'type required'); return true; }
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const cur = state.sectionIntroV1 && state.sectionIntroV1.sections ? state.sectionIntroV1 : { sections: {} };
        const sections = cur.sections || (cur.sections = {});
        const sec = sections[key] || (sections[key] = { blocks: [] });
        const blocks = Array.isArray(sec.blocks) ? sec.blocks : (sec.blocks = []);
        const id = `sblk_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const block = { id, pageId, parentId: parentId ?? null, sort: Number(sort) || (blocks.length ? (Math.max(...blocks.filter(b=> (b.parentId||null) === (parentId||null)).map(b=> Number(b.sort)||0)) + 1) : 0), type: String(type), propsJson: JSON.stringify(props||{}), contentJson: JSON.stringify(content||{}), createdAt: Date.now(), updatedAt: Date.now() };
        blocks.push(block);
        state.sectionIntroV1 = { sections };
        writeJsonAtomic(p, state);
        sendJson(res, 201, block);
        return true;
      }
      // Virtual Dashboard page blocks
      if (String(pageId) === 'dashboard') {
        const bodyRaw = await readBody(req);
        let body = {};
        try { body = JSON.parse(bodyRaw || '{}'); } catch {}
        const { type, parentId = null, sort = 0, props = {}, content = {} } = body;
        if (!type) { badRequest(res, 'type required'); return true; }
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const dash = (state.dashboardV1 && typeof state.dashboardV1 === 'object') ? state.dashboardV1 : (state.dashboardV1 = { blocks: [] });
        const blocks = Array.isArray(dash.blocks) ? dash.blocks : (dash.blocks = []);
        const id = `dblk_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const nextSort = Number(sort) || (blocks.length ? (Math.max(...blocks.filter(b => (b.parentId || null) === (parentId || null)).map(b => Number(b.sort) || 0)) + 1) : 0);
        const block = { id, pageId, parentId: parentId ?? null, sort: nextSort, type: String(type), propsJson: JSON.stringify(props||{}), contentJson: JSON.stringify(content||{}), createdAt: Date.now(), updatedAt: Date.now() };
        blocks.push(block);
        state.dashboardV1 = { blocks };
        writeJsonAtomic(p, state);
        sendJson(res, 201, block);
        return true;
      }
      // Virtual Session page blocks
      if (String(pageId) === 'session') {
        const bodyRaw = await readBody(req);
        let body = {};
        try { body = JSON.parse(bodyRaw || '{}'); } catch {}
        const { type, parentId = null, sort = 0, props = {}, content = {} } = body;
        if (!type) { badRequest(res, 'type required'); return true; }
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const sess = (state.sessionV1 && typeof state.sessionV1 === 'object') ? state.sessionV1 : (state.sessionV1 = { blocks: [] });
        const blocks = Array.isArray(sess.blocks) ? sess.blocks : (sess.blocks = []);
        const id = `ssblk_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        const nextSort = Number(sort) || (blocks.length ? (Math.max(...blocks.filter(b => (b.parentId || null) === (parentId || null)).map(b => Number(b.sort) || 0)) + 1) : 0);
        const block = { id, pageId, parentId: parentId ?? null, sort: nextSort, type: String(type), propsJson: JSON.stringify(props||{}), contentJson: JSON.stringify(content||{}), createdAt: Date.now(), updatedAt: Date.now() };
        blocks.push(block);
        state.sessionV1 = { blocks };
        writeJsonAtomic(p, state);
        sendJson(res, 201, block);
        return true;
      }
      const bodyRaw = await readBody(req);
      let body = {};
      try { body = JSON.parse(bodyRaw || '{}'); } catch {}
      const { type, parentId = null, sort = 0, props = {}, content = {} } = body;
      if (!type) { badRequest(res, 'type required'); return true; }
      const block = ctx.dbCreateBlock(ctx.db, { pageId, parentId, sort: Number(sort) || 0, type: String(type), props, content });
      sendJson(res, 201, block);
      return true;
    })();
  }

  // PATCH/DELETE /api/blocks/:id
  const blockMatch = pathname.match(/^\/api\/blocks\/([^\/]+)$/);
  if (blockMatch && req.method === 'PATCH') {
    return (async () => {
      const blockIdStr = decodePathParam(blockMatch[1]);

      // Handle Section Intro IDs first: intro_<key>_<index>
      if (String(blockIdStr).startsWith('intro_')) {
        const m = String(blockIdStr).match(/^intro_(.+?)_(\d+)$/);
        if (!m) { notFound(res); return true; }
        const key = m[1];
        const idx = Number(m[2]);
        const bodyRaw = await readBody(req);
        let patch = {};
        try { patch = JSON.parse(bodyRaw || '{}'); } catch {}
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const sections = state.sectionIntroV1?.sections || {};
        const sec = sections[key] || { blocks: [] };
        const blocks = Array.isArray(sec.blocks) ? sec.blocks : [];
        if (!(idx >= 0 && idx < blocks.length)) { notFound(res); return true; }
        const cur = blocks[idx];
        const updated = { ...cur };
        if (patch.type) updated.type = String(patch.type);
        if (patch.parentId !== undefined) updated.parentId = patch.parentId ?? null;
        if (patch.sort !== undefined) updated.sort = Number(patch.sort) || 0;
        if (patch.props !== undefined) updated.propsJson = JSON.stringify({ ...(JSON.parse(cur.propsJson||'{}')), ...(patch.props || {}) });
        if (patch.content !== undefined) updated.contentJson = JSON.stringify({ ...(JSON.parse(cur.contentJson||'{}')), ...(patch.content || {}) });
        updated.updatedAt = Date.now();
        blocks[idx] = updated;
        sections[key] = { blocks };
        state.sectionIntroV1 = { sections };
        writeJsonAtomic(p, state);
        sendJson(res, 200, updated);
        return true;
      }
      // Try patch in virtual Section Intro store first
      {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const sections = state.sectionIntroV1?.sections || {};
        for (const key of Object.keys(sections)) {
          const blocks = Array.isArray(sections[key]?.blocks) ? sections[key].blocks : [];
          const idx = blocks.findIndex(b => String(b.id) === String(blockIdStr));
          if (idx >= 0) {
            const bodyRaw = await readBody(req);
            let patch = {};
            try { patch = JSON.parse(bodyRaw || '{}'); } catch {}
            const cur = blocks[idx];
            // Apply supported fields
            const updated = { ...cur };
            if (patch.type) updated.type = String(patch.type);
            if (patch.parentId !== undefined) updated.parentId = patch.parentId ?? null;
            if (patch.sort !== undefined) updated.sort = Number(patch.sort) || 0;
            if (patch.props !== undefined) updated.propsJson = JSON.stringify({ ...(JSON.parse(cur.propsJson||'{}')), ...(patch.props || {}) });
            if (patch.content !== undefined) updated.contentJson = JSON.stringify({ ...(JSON.parse(cur.contentJson||'{}')), ...(patch.content || {}) });
            updated.updatedAt = Date.now();
            blocks[idx] = updated;
            state.sectionIntroV1 = { sections };
            writeJsonAtomic(p, state);
            sendJson(res, 200, updated);
            return true;
          }
        }
      }
      // Try patch in virtual Dashboard store
      {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const blocks = Array.isArray(state.dashboardV1?.blocks) ? state.dashboardV1.blocks : [];
        const idx = blocks.findIndex(b => String(b.id) === String(blockIdStr));
        if (idx >= 0) {
          const bodyRaw = await readBody(req);
          let patch = {};
          try { patch = JSON.parse(bodyRaw || '{}'); } catch {}
          const cur = blocks[idx];
          const updated = { ...cur };
          if (patch.type) updated.type = String(patch.type);
          if (patch.parentId !== undefined) updated.parentId = patch.parentId ?? null;
          if (patch.sort !== undefined) updated.sort = Number(patch.sort) || 0;
          if (patch.props !== undefined) updated.propsJson = JSON.stringify({ ...(JSON.parse(cur.propsJson||'{}')), ...(patch.props || {}) });
          if (patch.content !== undefined) updated.contentJson = JSON.stringify({ ...(JSON.parse(cur.contentJson||'{}')), ...(patch.content || {}) });
          updated.updatedAt = Date.now();
          blocks[idx] = updated;
          state.dashboardV1 = { blocks };
          writeJsonAtomic(p, state);
          sendJson(res, 200, updated);
          return true;
        }
      }
      // Try patch in virtual Session store
      {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const blocks = Array.isArray(state.sessionV1?.blocks) ? state.sessionV1.blocks : [];
        const idx = blocks.findIndex(b => String(b.id) === String(blockIdStr));
        if (idx >= 0) {
          const bodyRaw = await readBody(req);
          let patch = {};
          try { patch = JSON.parse(bodyRaw || '{}'); } catch {}
          const cur = blocks[idx];
          const updated = { ...cur };
          if (patch.type) updated.type = String(patch.type);
          if (patch.parentId !== undefined) updated.parentId = patch.parentId ?? null;
          if (patch.sort !== undefined) updated.sort = Number(patch.sort) || 0;
          if (patch.props !== undefined) updated.propsJson = JSON.stringify({ ...(JSON.parse(cur.propsJson||'{}')), ...(patch.props || {}) });
          if (patch.content !== undefined) updated.contentJson = JSON.stringify({ ...(JSON.parse(cur.contentJson||'{}')), ...(patch.content || {}) });
          updated.updatedAt = Date.now();
          blocks[idx] = updated;
          state.sessionV1 = { blocks };
          writeJsonAtomic(p, state);
          sendJson(res, 200, updated);
          return true;
        }
      }
      const bodyRaw = await readBody(req);
      let patch = {};
      try { patch = JSON.parse(bodyRaw || '{}'); } catch {}
      const updated = ctx.dbPatchBlock(ctx.db, blockIdStr, patch || {});
      if (!updated) { notFound(res); return true; }
      sendJson(res, 200, updated);
      return true;
    })();
  }
    if (blockMatch && req.method === 'DELETE') {
      return (async () => {
        const blockIdStr = decodePathParam(blockMatch[1]);

        // Handle Section Intro IDs first: intro_<key>_<index>
        if (String(blockIdStr).startsWith('intro_')) {
          const m = String(blockIdStr).match(/^intro_(.+?)_(\d+)$/);
          if (!m) { notFound(res); return true; }
          const key = m[1];
          const idx = Number(m[2]);
          const fs = await import('node:fs');
          const path = await import('node:path');
          const { defaultUserState } = await import('./userState.js');
          const p = path.join(ctx.USER_DIR, 'state.json');
          let state = defaultUserState();
          try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
          const sections = state.sectionIntroV1?.sections || {};
          const sec = sections[key] || { blocks: [] };
          const blocks = Array.isArray(sec.blocks) ? sec.blocks : [];
          if (!(idx >= 0 && idx < blocks.length)) { notFound(res); return true; }
          blocks.splice(idx, 1);
          sections[key] = { blocks };
          state.sectionIntroV1 = { sections };
          writeJsonAtomic(p, state);
          sendJson(res, 200, { ok: true });
          return true;
        }

        // Try delete in section store first by matching id
        {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const { defaultUserState } = await import('./userState.js');
          const p = path.join(ctx.USER_DIR, 'state.json');
          let state = defaultUserState();
          try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
          const sections = state.sectionIntroV1?.sections || {};
          for (const key of Object.keys(sections)) {
            const blocks = Array.isArray(sections[key]?.blocks) ? sections[key].blocks : [];
            const idx = blocks.findIndex(b => String(b.id) === String(blockIdStr));
            if (idx >= 0) {
              blocks.splice(idx, 1);
              state.sectionIntroV1 = { sections };
              writeJsonAtomic(p, state);
              sendJson(res, 200, { ok: true });
              return true;
            }
          }
        }
        // Try delete in dashboard store by matching id
        {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const { defaultUserState } = await import('./userState.js');
            const p = path.join(ctx.USER_DIR, 'state.json');
          let state = defaultUserState();
          try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
          const blocks = Array.isArray(state.dashboardV1?.blocks) ? state.dashboardV1.blocks : [];
          const idx = blocks.findIndex(b => String(b.id) === String(blockIdStr));
          if (idx >= 0) {
            blocks.splice(idx, 1);
            state.dashboardV1 = { blocks };
            writeJsonAtomic(p, state);
            sendJson(res, 200, { ok: true });
            return true;
          }
        }
        // Try delete in session store by matching id
        {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const { defaultUserState } = await import('./userState.js');
          const p = path.join(ctx.USER_DIR, 'state.json');
          let state = defaultUserState();
          try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
          const blocks = Array.isArray(state.sessionV1?.blocks) ? state.sessionV1.blocks : [];
          const idx = blocks.findIndex(b => String(b.id) === String(blockIdStr));
          if (idx >= 0) {
            blocks.splice(idx, 1);
            state.sessionV1 = { blocks };
            writeJsonAtomic(p, state);
            sendJson(res, 200, { ok: true });
            return true;
          }
        }
        const ok = await Promise.resolve(ctx.dbDeleteBlock(ctx.db, blockIdStr));
        if (!ok) { notFound(res); return true; }
        sendJson(res, 200, { ok: true });
        return true;
      })();
    }

  // POST /api/blocks/reorder
  if (pathname === '/api/blocks/reorder' && req.method === 'POST') {
    return (async () => {
      const bodyRaw = await readBody(req);
      let reqBody = {};
      try { reqBody = JSON.parse(bodyRaw || '{}'); } catch {}
      const pageId = reqBody.pageId;
      const moves = Array.isArray(reqBody.moves) ? reqBody.moves.map(m => ({ id: m.id, parentId: m.parentId ?? null, sort: Number(m.sort) || 0 })) : [];
      if (!pageId) { badRequest(res, 'pageId required'); return true; }
      // Reorder for section intro virtual page
      const secMatch = String(pageId).match(/^section:(.+)$/);
      if (secMatch) {
        const key = secMatch[1];
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const sections = state.sectionIntroV1?.sections || {};
        const sec = sections[key] || { blocks: [] };
        const blocks = Array.isArray(sec.blocks) ? sec.blocks : [];
        const byId = new Map(blocks.map(b => [String(b.id), b]));
        for (const mv of moves) {
          const b = byId.get(String(mv.id));
          if (!b) continue;
          b.parentId = mv.parentId ?? null;
          b.sort = Number(mv.sort) || 0;
          b.updatedAt = Date.now();
        }
        // Persist ordering
        sec.blocks = Array.from(byId.values());
        sections[key] = sec;
        state.sectionIntroV1 = { sections };
        writeJsonAtomic(p, state);
        sendJson(res, 200, { ok: true });
        return true;
      }
      // Reorder for dashboard virtual page
      if (String(pageId) === 'dashboard') {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const dash = (state.dashboardV1 && typeof state.dashboardV1 === 'object') ? state.dashboardV1 : { blocks: [] };
        const blocks = Array.isArray(dash.blocks) ? dash.blocks : [];
        const byId = new Map(blocks.map(b => [String(b.id), b]));
        for (const mv of moves) {
          const b = byId.get(String(mv.id));
          if (!b) continue;
          b.parentId = mv.parentId ?? null;
          b.sort = Number(mv.sort) || 0;
          b.updatedAt = Date.now();
        }
        state.dashboardV1 = { blocks: Array.from(byId.values()) };
        writeJsonAtomic(p, state);
        sendJson(res, 200, { ok: true });
        return true;
      }
      // Reorder for session virtual page
      if (String(pageId) === 'session') {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const { defaultUserState } = await import('./userState.js');
        const p = path.join(ctx.USER_DIR, 'state.json');
        let state = defaultUserState();
        try { state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        const sess = (state.sessionV1 && typeof state.sessionV1 === 'object') ? state.sessionV1 : { blocks: [] };
        const blocks = Array.isArray(sess.blocks) ? sess.blocks : [];
        const byId = new Map(blocks.map(b => [String(b.id), b]));
        for (const mv of moves) {
          const b = byId.get(String(mv.id));
          if (!b) continue;
          b.parentId = mv.parentId ?? null;
          b.sort = Number(mv.sort) || 0;
          b.updatedAt = Date.now();
        }
        state.sessionV1 = { blocks: Array.from(byId.values()) };
        writeJsonAtomic(p, state);
        sendJson(res, 200, { ok: true });
        return true;
      }
      const out = ctx.dbReorderBlocks(ctx.db, pageId, moves);
      sendJson(res, 200, out);
      return true;
    })();
  }

  return false;
}
