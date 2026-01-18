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
    variant = 'default',
    // New: control how the cover image fits inside the header
    // 'cover' (crop/fill) or 'contain' (show all with letterboxing)
    sizeMode = 'cover',
    // New: optional custom height (number in px)
    heightPx = null,
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
  if (mode === 'edit') wrap.classList.add('headerMedia--edit');
  if (variant === 'tall') wrap.classList.add('headerMedia--tall');
  if (sizeMode === 'contain') wrap.classList.add('headerMedia--contain');
  // Ensure positioning anchor for absolute children
  wrap.style.position = 'relative';
  const coverDiv = document.createElement('div');
  coverDiv.className = 'cover';
  coverDiv.style.position = 'relative';
  // Apply explicit height override if provided (wins over CSS rules)
  if (Number.isFinite(heightPx) && heightPx > 0) {
    try { coverDiv.style.height = `${Math.floor(heightPx)}px`; } catch {}
  }
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

  // Add a dock row above the cover in edit mode
  let dockRight = null;
  if (mode === 'edit') {
    const dock = document.createElement('div');
    dock.className = 'headerMediaDock';
    dockRight = document.createElement('div');
    dockRight.className = 'headerMediaDockRight';
    dock.appendChild(dockRight);
    // Insert the dock before the cover element
    wrap.insertBefore(dock, coverDiv);
  }

  // Footer row for controls (below cover)
  // Kept for profile tools and spacing; cover tools now overlay inside the cover
  const footer = document.createElement('div'); footer.className = 'headerMediaFooter';
  const footerLeft = document.createElement('div'); footerLeft.className = 'headerMediaFooterLeft';
  const footerRight = document.createElement('div'); footerRight.className = 'headerMediaFooterRight';
  footer.appendChild(footerLeft); footer.appendChild(footerRight);
  wrap.appendChild(footer);
  // Help spacing if profile is shown
  wrap.classList.toggle('hasProfile', !!showProfile);

  // Overlay controls (edit mode)
  if (mode === 'edit') {
    const ctl = document.createElement('div');
    // Named container; CSS handles layout/positioning
    ctl.className = 'headerMediaControls';

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
      try {
        // quick client-side checks for type/size
        const { explainUploadError, showUploadErrorDialog } = await import('../lib/userError.js');
        const ALLOWED = ['image/png','image/jpeg','image/webp','image/gif','image/avif'];
        if (f.type && !ALLOWED.some(t => (f.type || '').includes(t))) {
          showUploadErrorDialog(explainUploadError(null, { file: f }));
          return;
        }
        if (Number.isFinite(f.size) && f.size > 10 * 1024 * 1024) {
          showUploadErrorDialog(explainUploadError(null, { file: f }));
          return;
        }
        await onUploadCover?.(f);
      } catch (e) {
        try {
          const { explainUploadError, showUploadErrorDialog } = await import('../lib/userError.js');
          showUploadErrorDialog(explainUploadError(e, { file: f }));
        } catch {}
      } finally {
        fileInputCover.value = '';
      }
    };
    ctl.appendChild(addOrChangeBtn);

    if (cover) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'chip'; removeBtn.type = 'button'; removeBtn.textContent = 'Remove';
      removeBtn.onclick = async () => { try { await onRemoveCover?.(); } catch (e) { console.error(e); } };
      ctl.appendChild(removeBtn);
    }
    if (cover && typeof onSavePosition === 'function') {
      const repositionBtn = document.createElement('button');
      repositionBtn.className = 'chip'; repositionBtn.type = 'button'; repositionBtn.textContent = 'Reposition';
      ctl.appendChild(repositionBtn);

      // Reposition logic
      repositionBtn.onclick = () => {
        if (!cover) return;
        // curX/curY are the single source of truth during a session
        let curX = Number(cover.posX ?? 50);
        let curY = Number(cover.posY ?? 50);
        // base values for each drag gesture (updated on pointerdown from curX/curY)
        let baseX = curX, baseY = curY;
        let ptStart = null;
        const overlay = document.createElement('div');
        overlay.style.position = 'absolute';
        overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.right = '0'; overlay.style.bottom = '0';
        overlay.style.cursor = 'grab';
        overlay.style.background = 'rgba(0,0,0,0.08)';
        // Hide normal cover controls while repositioning
        ctl.style.display = 'none';
        // Add reposition bar into the dock (edit) or fallback to inside cover
        const bar = document.createElement('div');
        bar.className = 'headerMediaRepositionBar';
        const saveBtn = document.createElement('button'); saveBtn.className = 'chip'; saveBtn.textContent = 'Save';
        const cancelBtn = document.createElement('button'); cancelBtn.className = 'chip'; cancelBtn.textContent = 'Cancel';
        bar.appendChild(saveBtn); bar.appendChild(cancelBtn);
        coverDiv.appendChild(overlay);
        (dockRight ?? coverDiv).appendChild(bar);

        const onPointerDown = (e) => {
          overlay.setPointerCapture(e.pointerId);
          overlay.style.cursor = 'grabbing';
          const r = coverDiv.getBoundingClientRect();
          ptStart = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
          // Start from the current in-session values to avoid snap-back
          baseX = curX;
          baseY = curY;
          e.preventDefault();
        };
        const onPointerMove = (e) => {
          if (!ptStart) return;
          const dx = e.clientX - ptStart.x;
          const dy = e.clientY - ptStart.y;
          curX = clamp(baseX + (dx / ptStart.w) * 100, 0, 100);
          curY = clamp(baseY + (dy / ptStart.h) * 100, 0, 100);
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
        cancelBtn.onclick = () => {
          overlay.remove();
          bar.remove();
          coverDiv.style.backgroundPosition = posStr(cover);
          ctl.style.display = '';
        };
        saveBtn.onclick = async () => {
          if (typeof onSavePosition !== 'function') {
            console.warn('HeaderMedia: onSavePosition missing');
            overlay.remove();
            bar.remove();
            ctl.style.display = '';
            return;
          }
          try {
            await onSavePosition('header', curX, curY);
            if (cover) { cover.posX = curX; cover.posY = curY; }
            coverDiv.style.backgroundPosition = `${curX}% ${curY}%`;
          } catch (e) { console.error(e); }
          overlay.remove();
          bar.remove();
          ctl.style.display = '';
        };
      };
    }
    // Mount cover controls into the dock (edit) or fallback to inside cover
    (dockRight ?? coverDiv).appendChild(ctl);
  }

  // Profile image (view if present; edit supports add/change/remove and reposition/zoom)
  if (showProfile && (profile || mode === 'edit')) {
    const hasProfile = !!(profile && profile.url);
    if (hasProfile) {
      // Wrapper provides circular clip and border/shadow; inner image can transform
      const clip = document.createElement('div');
      clip.className = 'profileWrap';
      // Apply CSS vars for position and zoom (fallbacks handled in CSS)
      const posX = Number(profile?.posX ?? 50);
      const posY = Number(profile?.posY ?? 50);
      const zoom = Number(profile?.zoom ?? 1);
      clip.style.setProperty('--profile-pos', `${posX}% ${posY}%`);
      clip.style.setProperty('--profile-zoom', String(zoom));
      const img = document.createElement('img');
      img.className = 'profile';
      img.src = profile.url;
      img.alt = '';
      // Inline styles for modern browsers without waiting on CSS
      img.style.objectPosition = `${posX}% ${posY}%`;
      img.style.transformOrigin = `${posX}% ${posY}%`;
      img.style.transform = `scale(${zoom})`;
      clip.appendChild(img);
      wrap.appendChild(clip);
    }
    if (mode === 'edit') {
      const pCtl = document.createElement('div');
      // Profile controls live in footer (left)
      pCtl.className = 'headerMediaProfileControls';
      const fileInput = document.createElement('input');
      fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
      const btn = document.createElement('button');
      btn.className = 'chip'; btn.type = 'button'; btn.textContent = profile ? 'Change profile' : 'Add profile';
      btn.onclick = () => fileInput.click();
      fileInput.onchange = async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return; fileInput.value = '';
        try {
          const { explainUploadError, showUploadErrorDialog } = await import('../lib/userError.js');
          const ALLOWED = ['image/png','image/jpeg','image/webp','image/gif','image/avif'];
          if (f.type && !ALLOWED.some(t => (f.type || '').includes(t))) {
            showUploadErrorDialog(explainUploadError(null, { file: f }));
            return;
          }
          if (Number.isFinite(f.size) && f.size > 10 * 1024 * 1024) {
            showUploadErrorDialog(explainUploadError(null, { file: f }));
            return;
          }
          await onUploadProfile?.(f);
        } catch (e) {
          try {
            const { explainUploadError, showUploadErrorDialog } = await import('../lib/userError.js');
            showUploadErrorDialog(explainUploadError(e, { file: f }));
          } catch {}
        }
      };
      pCtl.appendChild(btn);
      if (profile) {
        const rm = document.createElement('button'); rm.className = 'chip'; rm.type = 'button'; rm.textContent = 'Remove profile';
        rm.onclick = async () => { try { await onRemoveProfile?.(); } catch (e) { console.error(e); } };
        pCtl.appendChild(rm);

        // Reposition + Zoom controls when a profile image exists
        if (typeof onSavePosition === 'function') {
          const adjustBtn = document.createElement('button');
          adjustBtn.className = 'chip'; adjustBtn.type = 'button'; adjustBtn.textContent = 'Reposition';
          pCtl.appendChild(adjustBtn);

          adjustBtn.onclick = () => {
            // Find current clip/img
            const clip = wrap.querySelector('.profileWrap');
            const img = wrap.querySelector('.profileWrap > img.profile');
            if (!clip || !img) return;
            // Working values
            let curX = Number(profile?.posX ?? 50);
            let curY = Number(profile?.posY ?? 50);
            let curZ = Number(profile?.zoom ?? 1);
            let baseX = curX, baseY = curY;
            let ptStart = null;

            // Build adjustment bar: Zoom slider + Save/Cancel
            const bar = document.createElement('div');
            bar.className = 'headerMediaRepositionBar';
            bar.style.padding = '8px';
            bar.style.display = 'flex'; bar.style.gap = '8px'; bar.style.alignItems = 'center';
            const zoomLabel = document.createElement('span'); zoomLabel.className = 'meta'; zoomLabel.textContent = 'Zoom';
            const zoomInput = document.createElement('input');
            zoomInput.type = 'range'; zoomInput.min = '0.5'; zoomInput.max = '3'; zoomInput.step = '0.01';
            zoomInput.value = String(curZ);
            const saveBtn = document.createElement('button'); saveBtn.className = 'chip'; saveBtn.textContent = 'Save';
            const cancelBtn = document.createElement('button'); cancelBtn.className = 'chip'; cancelBtn.textContent = 'Cancel';
            bar.appendChild(zoomLabel); bar.appendChild(zoomInput); bar.appendChild(saveBtn); bar.appendChild(cancelBtn);
            footerLeft.appendChild(bar);

            // Visual overlay over the clip to allow dragging
            const overlay = document.createElement('div');
            overlay.style.position = 'absolute';
            overlay.style.inset = 'auto auto 0 0';
            overlay.style.width = '140px';
            overlay.style.height = '140px';
            overlay.style.left = '16px';
            overlay.style.cursor = 'grab';
            overlay.style.zIndex = '4';
            overlay.style.borderRadius = '999px';
            overlay.style.background = 'rgba(0,0,0,0.0)';
            wrap.appendChild(overlay);

            const apply = () => {
              img.style.objectPosition = `${curX}% ${curY}%`;
              img.style.transformOrigin = `${curX}% ${curY}%`;
              img.style.transform = `scale(${curZ})`;
              clip.style.setProperty('--profile-pos', `${curX}% ${curY}%`);
              clip.style.setProperty('--profile-zoom', String(curZ));
            };
            apply();

            overlay.addEventListener('pointerdown', (e) => {
              overlay.setPointerCapture(e.pointerId);
              overlay.style.cursor = 'grabbing';
              const r = clip.getBoundingClientRect();
              ptStart = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
              baseX = curX; baseY = curY;
              e.preventDefault();
            });
            overlay.addEventListener('pointermove', (e) => {
              if (!ptStart) return;
              const dx = e.clientX - ptStart.x;
              const dy = e.clientY - ptStart.y;
              curX = clamp(baseX + (dx / ptStart.w) * 100, 0, 100);
              curY = clamp(baseY + (dy / ptStart.h) * 100, 0, 100);
              apply();
            });
            overlay.addEventListener('pointerup', (e) => {
              try { overlay.releasePointerCapture(e.pointerId); } catch {}
              overlay.style.cursor = 'grab';
              ptStart = null;
            });
            zoomInput.addEventListener('input', () => {
              const z = Number(zoomInput.value);
              curZ = clamp(z, 0.5, 3);
              apply();
            });

            cancelBtn.onclick = () => {
              try { overlay.remove(); } catch {}
              try { bar.remove(); } catch {}
              // Restore original
              curX = Number(profile?.posX ?? 50);
              curY = Number(profile?.posY ?? 50);
              curZ = Number(profile?.zoom ?? 1);
              apply();
            };
            saveBtn.onclick = async () => {
              saveBtn.disabled = true;
              try {
                await onSavePosition('profile', curX, curY, curZ);
                if (profile) { profile.posX = curX; profile.posY = curY; profile.zoom = curZ; }
                try { overlay.remove(); } catch {}
                try { bar.remove(); } catch {}
              } catch (e) {
                console.error('[media] failed to save position', e);
                saveBtn.disabled = false;
              }
            };
          };
        }
      }
      wrap.appendChild(fileInput);
      footerLeft.appendChild(pCtl);
    }
  }

  hostEl.innerHTML = '';
  hostEl.appendChild(wrap);
}
