import { escapeHtml } from '../../lib/dom.js';
import { canonicalPageHref } from '../../lib/pageUrl.js';

function renderOptions(list, selected, getValue, getLabel) {
  return list.map((item) => {
    const value = getValue(item);
    const label = getLabel(item);
    return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function renderLinkedPages(pages) {
  if (!pages.length) return '';
  return `
    <div class="meta" style="display:flex; gap:6px; flex-wrap:wrap;">
      <span>Linked:</span>
      ${pages.map((page) => `<a href="${canonicalPageHref(page)}" data-link>${escapeHtml(page.title)}</a>`).join(' · ')}
    </div>
  `;
}

function renderEventActions(event) {
  const archiveLabel = event.archivedAt ? 'Restore' : 'Archive';
  return `
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
      <button type="button" class="chip" data-timeline-action="edit" data-event-id="${escapeHtml(event.id)}">Edit</button>
      <button type="button" class="chip" data-timeline-action="archive" data-event-id="${escapeHtml(event.id)}">${archiveLabel}</button>
      <button type="button" class="chip" data-timeline-action="delete" data-event-id="${escapeHtml(event.id)}">Delete</button>
    </div>
  `;
}

function renderEvent(event) {
  const tags = event.tags?.length
    ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">${event.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
  const metaBits = [
    event.eventType || '',
    event.arc ? `Arc: ${event.arc.title}` : '',
    event.location ? `Location: ${event.location.title}` : '',
    event.archivedAt ? 'Archived' : '',
  ].filter(Boolean);
  return `
    <article class="card" style="margin: 0 0 12px;">
      <div class="meta" style="margin-bottom:6px;">${escapeHtml(event.date?.label || '')}</div>
      <h2 style="margin:0 0 6px;">${escapeHtml(event.title)}</h2>
      ${metaBits.length ? `<div class="meta" style="margin-bottom:8px;">${escapeHtml(metaBits.join(' · '))}</div>` : ''}
      ${event.summary ? `<p style="margin:0 0 10px;">${escapeHtml(event.summary)}</p>` : '<p class="meta" style="margin:0 0 10px;">No summary yet.</p>'}
      ${renderLinkedPages(Array.isArray(event.linkedPages) ? event.linkedPages : [])}
      ${tags}
      ${renderEventActions(event)}
    </article>
  `;
}

function groupEventsByYear(events) {
  const groups = [];
  for (const event of events) {
    const year = String(event?.date?.start?.year ?? 'Unknown');
    const last = groups[groups.length - 1];
    if (!last || last.year !== year) groups.push({ year, events: [event] });
    else last.events.push(event);
  }
  return groups;
}

export function renderTimelineShell() {
  return `
    <section>
      <h1>Timeline</h1>
      <p class="meta" style="margin-top: 6px;">Chronology is backed by dedicated timeline events while pages remain the canonical linked records.</p>
      <section class="card" style="margin: 12px 0;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
          <div>
            <h2 id="timelineFormHeading" style="margin:0;">Add event</h2>
            <p id="timelineFormSubheading" class="meta" style="margin:6px 0 0;">Create a new chronology entry.</p>
          </div>
          <div id="timelineCreateStatus" class="meta"></div>
        </div>
        <form id="timelineCreateForm" style="display:grid; gap:10px; margin-top:10px;">
          <label style="display:grid; gap:4px;">
            <span class="meta">Title</span>
            <input name="title" required maxlength="200" placeholder="Founding of Moon Harbor" />
          </label>
          <label style="display:grid; gap:4px;">
            <span class="meta">Summary</span>
            <textarea name="summary" rows="3" maxlength="1000" placeholder="Short overview shown on the timeline card."></textarea>
          </label>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:10px;">
            <label style="display:grid; gap:4px;">
              <span class="meta">Type</span>
              <input name="eventType" maxlength="64" placeholder="history, session, war…" />
            </label>
            <label style="display:grid; gap:4px;">
              <span class="meta">Start precision</span>
              <select name="startPrecision">
                <option value="year">Year</option>
                <option value="month">Month</option>
                <option value="day" selected>Day</option>
              </select>
            </label>
            <label style="display:grid; gap:4px;">
              <span class="meta">Start year</span>
              <input name="startYear" type="number" required placeholder="1024" />
            </label>
            <label style="display:grid; gap:4px;">
              <span class="meta">Start month</span>
              <input name="startMonth" type="number" min="1" max="12" placeholder="6" />
            </label>
            <label style="display:grid; gap:4px;">
              <span class="meta">Start day</span>
              <input name="startDay" type="number" min="1" max="31" placeholder="14" />
            </label>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:10px;">
            <label style="display:grid; gap:4px;">
              <span class="meta">End precision</span>
              <select name="endPrecision">
                <option value="">No end date</option>
                <option value="year">Year</option>
                <option value="month">Month</option>
                <option value="day">Day</option>
              </select>
            </label>
            <label style="display:grid; gap:4px;">
              <span class="meta">End year</span>
              <input name="endYear" type="number" placeholder="1025" />
            </label>
            <label style="display:grid; gap:4px;">
              <span class="meta">End month</span>
              <input name="endMonth" type="number" min="1" max="12" placeholder="7" />
            </label>
            <label style="display:grid; gap:4px;">
              <span class="meta">End day</span>
              <input name="endDay" type="number" min="1" max="31" placeholder="1" />
            </label>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:10px;">
            <label style="display:grid; gap:4px;">
              <span class="meta">Arc page</span>
              <div id="timelineArcPicker"></div>
            </label>
            <label style="display:grid; gap:4px;">
              <span class="meta">Location page</span>
              <div id="timelineLocationPicker"></div>
            </label>
          </div>
          <label style="display:grid; gap:4px;">
            <span class="meta">Linked pages</span>
            <div id="timelineLinkedPagesPicker"></div>
          </label>
          <label style="display:grid; gap:4px;">
            <span class="meta">Tags</span>
            <input name="tags" placeholder="origin, capital, faction" />
          </label>
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button type="button" id="timelineCancelEdit" class="chip" hidden>Cancel edit</button>
            <button type="reset" class="chip">Clear</button>
            <button type="submit" id="timelineSubmitButton" class="chip" data-primary>Create event</button>
          </div>
        </form>
      </section>
      <section class="card" style="margin: 12px 0;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
          <label style="display:flex; flex-direction:column; gap:4px;">
            <span class="meta">Type</span>
            <select id="timelineTypeFilter"><option value="">All types</option></select>
          </label>
          <label style="display:flex; flex-direction:column; gap:4px;">
            <span class="meta">Arc</span>
            <select id="timelineArcFilter"><option value="">All arcs</option></select>
          </label>
          <label style="display:flex; flex-direction:column; gap:4px;">
            <span class="meta">Location</span>
            <select id="timelineLocationFilter"><option value="">All locations</option></select>
          </label>
          <label style="display:flex; flex-direction:column; gap:4px;">
            <span class="meta">Tag</span>
            <select id="timelineTagFilter"><option value="">All tags</option></select>
          </label>
          <label style="display:flex; flex-direction:column; gap:4px;">
            <span class="meta">Archive</span>
            <select id="timelineArchivedFilter">
              <option value="exclude">Active only</option>
              <option value="include">Active + archived</option>
              <option value="only">Archived only</option>
            </select>
          </label>
        </div>
      </section>
      <div id="timelineSummary" class="meta" style="margin-bottom: 10px;">Loading…</div>
      <div id="timelineList"></div>
    </section>
  `;
}

export function applyFilterOptions(elements, filters, state) {
  elements.typeEl.innerHTML = `<option value="">All types</option>${renderOptions(filters.eventTypes || [], state.eventType, (item) => item.value, (item) => `${item.value} (${item.count})`)}`;
  elements.arcEl.innerHTML = `<option value="">All arcs</option>${renderOptions(filters.arcs || [], state.arcPageId, (item) => item.id, (item) => `${item.title} (${item.count})`)}`;
  elements.locationEl.innerHTML = `<option value="">All locations</option>${renderOptions(filters.locations || [], state.locationPageId, (item) => item.id, (item) => `${item.title} (${item.count})`)}`;
  elements.tagEl.innerHTML = `<option value="">All tags</option>${renderOptions(filters.tags || [], state.tag, (item) => item.name, (item) => `${item.display} (${item.count})`)}`;
  elements.archivedEl.value = state.archived;
}

export function renderTimelineList(container, events) {
  if (!events.length) {
    container.innerHTML = `<section class="card"><p class="meta" style="margin:0;">No timeline events match the current filters yet.</p></section>`;
    return;
  }
  const groups = groupEventsByYear(events);
  container.innerHTML = groups.map((group) => `
    <section style="margin-bottom: 16px;">
      <div class="meta" style="margin: 0 0 8px;">${escapeHtml(group.year)}</div>
      ${group.events.map(renderEvent).join('')}
    </section>
  `).join('');
}
