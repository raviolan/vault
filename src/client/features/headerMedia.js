// Header Media UI: cover image + optional profile circle

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

export function renderHeaderMedia(hostEl, opts) {
  const {
    mode = 'view',
    cover = null,
    profile = null,
    showProfile = false,
    onUploadCover = null,
    onUploadProfile = null,
    onRemoveCover = null,
    onRemoveProfile = null,
    onSavePosition = null,
  } = opts || {};

  if (!hostEl) return;

  // In view mode, render nothing when no media
  if (mode === 'view' && !cover && (!showProfile || !profile)) {
    hostEl.innerHTML = '';
    return;
  }

  const posStr = (slot) => `${Number(slot?.posX ?? 50)}% ${Number(slot?.posY ?? 50)}%`;

  // Build structure
  const wrap = document.createElement('div');
  wrap.className = 'headerMedia';
  const coverDiv = document.createElement('div');
  coverDiv.className = 'cover';
  if (cover && cover.url) {
    coverDiv.style.setProperty('background-image', `url(${cover.url})`);
    coverDiv.style.setProperty('--pos', posStr(cover));
    coverDiv.style.backgroundPosition = posStr(cover);
  } else if (mode === 'edit') {
    // Always render container in edit mode
    coverDiv.style.backgroundColor = 'var(--muted-bg, #111)';
    coverDiv.style.backgroundImage = '';
  }
  coverDiv.style.backgroundSize = 'cover';
  coverDiv.style.backgroundRepeat = 'no-repeat';
  wrap.appendChild(coverDiv);

  // Overlay controls (edit mode)
  if (mode === 'edit') {
    const ctl = document.createElement('div');
    ctl.style.position = 'absolute';
    ctl.style.right = '12px';
    ctl.style.bottom = '12px';
    ctl.style.display = 'flex';
    ctl.style.gap = '8px';

    const fileInputCover = document.createElement('input');
    fileInputCover.type = 'file';
    fileInputCover.accept = 'image/*';
    fileInputCover.style.display = 'none';
    wrap.appendChild(fileInputCover);

    const addOrChangeBtn = document.createElement('button');
    addOrChangeBtn.className = 'chip';
    addOrChangeBtn.type = 'button';
    addOrChangeBtn.textContent = cover ? 'Change cover' : 'Add cover';
    addOrChangeBtn.onclick = () => fileInputCover.click();
    fileInputCover.onchange = async () => {
      const f = fileInputCover.files && fileInputCover.files[0];
      if (!f) return;
      try { await onUploadCover?.(f); } catch (e) { console.error('upload cover failed', e); }
      fileInputCover.value = '';
    };
    ctl.appendChild(addOrChangeBtn);

    if (cover) {
      const repositionBtn = document.createElement('button');
      repositionBtn.className = 'chip'; repositionBtn.type = 'button'; repositionBtn.textContent = 'Reposition';
      ctl.appendChild(repositionBtn);
      const removeBtn = document.createElement('button');
      removeBtn.className = 'chip'; removeBtn.type = 'button'; removeBtn.textContent = 'Remove';
      removeBtn.onclick = async () => { try { await onRemoveCover?.(); } catch (e) { console.error(e); } };
      ctl.appendChild(removeBtn);

      // Reposition logic
      repositionBtn.onclick = () => {
        if (!cover) return;
        let startX = Number(cover.posX ?? 50);
        let startY = Number(cover.posY ?? 50);
        let curX = startX, curY = startY;
        let ptStart = null;
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.right = '0'; overlay.style.bottom = '0';
        overlay.style.cursor = 'grab';
        overlay.style.background = 'rgba(0,0,0,0.08)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'flex-end';
        overlay.style.justifyContent = 'flex-end';
        const bar = document.createElement('div');
        bar.style.padding = '8px';
        bar.style.display = 'flex'; bar.style.gap = '8px';
        const saveBtn = document.createElement('button'); saveBtn.className = 'chip'; saveBtn.textContent = 'Save';
        const cancelBtn = document.createElement('button'); cancelBtn.className = 'chip'; cancelBtn.textContent = 'Cancel';
        bar.appendChild(saveBtn); bar.appendChild(cancelBtn);
        overlay.appendChild(bar);
        coverDiv.appendChild(overlay);

        const onPointerDown = (e) => {
          overlay.setPointerCapture(e.pointerId);
          overlay.style.cursor = 'grabbing';
          const r = coverDiv.getBoundingClientRect();
          ptStart = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
          startX = Number(cover.posX ?? 50);
          startY = Number(cover.posY ?? 50);
          e.preventDefault();
        };
        const onPointerMove = (e) => {
          if (!ptStart) return;
          const dx = e.clientX - ptStart.x;
          const dy = e.clientY - ptStart.y;
          curX = clamp(startX + (dx / ptStart.w) * 100, 0, 100);
          curY = clamp(startY + (dy / ptStart.h) * 100, 0, 100);
          coverDiv.style.backgroundPosition = `${curX}% ${curY}%`;
        };
        const onPointerUp = (e) => {
          try { overlay.releasePointerCapture(e.pointerId); } catch {}
          overlay.style.cursor = 'grab';
          ptStart = null;
        };
        overlay.addEventListener('pointerdown', onPointerDown);
        overlay.addEventListener('pointermove', onPointerMove);
        overlay.addEventListener('pointerup', onPointerUp);

        cancelBtn.onclick = () => { overlay.remove(); coverDiv.style.backgroundPosition = posStr(cover); };
        saveBtn.onclick = async () => {
          try { await onSavePosition?.('header', curX, curY); } catch (e) { console.error(e); }
          overlay.remove();
        };
      };
    }

    coverDiv.appendChild(ctl);
  }

  // Profile image (view if present, edit supports add/change/remove only)
  if (showProfile && (profile || mode === 'edit')) {
    if (profile && profile.url) {
      const img = document.createElement('img');
      img.className = 'profile';
      img.src = profile.url;
      img.alt = '';
      wrap.appendChild(img);
    }
    if (mode === 'edit') {
      const pCtl = document.createElement('div');
      pCtl.style.position = 'relative';
      pCtl.style.marginTop = '8px';
      const fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
      const btn = document.createElement('button');
      btn.className = 'chip'; btn.type = 'button'; btn.textContent = profile ? 'Change profile' : 'Add profile';
      btn.onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return; fileInput.value = '';
        try { await onUploadProfile?.(f); } catch (e) { console.error('upload profile failed', e); }
      };
      pCtl.appendChild(btn);
      if (profile) {
        const rm = document.createElement('button'); rm.className = 'chip'; rm.type = 'button'; rm.textContent = 'Remove profile';
        rm.onclick = async () => { try { await onRemoveProfile?.(); } catch (e) { console.error(e); } };
        pCtl.appendChild(rm);
      }
      wrap.appendChild(fileInput);
      wrap.appendChild(pCtl);
    }
  }

  hostEl.innerHTML = '';
  hostEl.appendChild(wrap);
}

