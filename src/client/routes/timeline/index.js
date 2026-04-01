import { createTimelineEvent, deleteTimelineEvent, fetchTimeline, updateTimelineEvent } from './api.js';
import { renderTimelineShell, applyFilterOptions, renderTimelineList } from './render.js';
import { createTimelineState, extractDateFields, parseTags } from './state.js';
import { mountTimelinePagePicker } from '../timelinePagePicker.js';
import { escapeHtml } from '../../lib/dom.js';

function getFormPayload(createForm, pickers) {
  const formData = new FormData(createForm);
  const arc = pickers.arcPicker.getValue();
  const location = pickers.locationPicker.getValue();
  const linkedPages = pickers.linkedPagesPicker.getValue();
  const payload = {
    title: String(formData.get('title') || '').trim(),
    summary: String(formData.get('summary') || '').trim(),
    eventType: String(formData.get('eventType') || '').trim(),
    startPrecision: String(formData.get('startPrecision') || 'day'),
    startYear: String(formData.get('startYear') || '').trim(),
    startMonth: String(formData.get('startMonth') || '').trim(),
    startDay: String(formData.get('startDay') || '').trim(),
    endPrecision: String(formData.get('endPrecision') || '').trim(),
    endYear: String(formData.get('endYear') || '').trim(),
    endMonth: String(formData.get('endMonth') || '').trim(),
    endDay: String(formData.get('endDay') || '').trim(),
    arcPageId: arc?.id || '',
    locationPageId: location?.id || '',
    linkedPageIds: linkedPages.map((item) => item.id),
    tags: parseTags(formData.get('tags')),
  };
  if (!payload.endPrecision) {
    delete payload.endPrecision;
    delete payload.endYear;
    delete payload.endMonth;
    delete payload.endDay;
  }
  return payload;
}

function syncFormMode(elements, state) {
  const editing = !!state.editingEventId;
  elements.formHeading.textContent = editing ? 'Edit event' : 'Add event';
  elements.formSubheading.textContent = editing ? 'Update the selected chronology entry.' : 'Create a new chronology entry.';
  elements.submitButton.textContent = editing ? 'Save changes' : 'Create event';
  elements.cancelEdit.hidden = !editing;
}

function setBusy(elements, pickers, state, busy, message = '') {
  state.formBusy = !!busy;
  elements.createStatusEl.textContent = message;
  elements.createForm.querySelectorAll('input, textarea, select, button').forEach((el) => {
    el.disabled = !!busy;
  });
  pickers.arcPicker.setDisabled(busy);
  pickers.locationPicker.setDisabled(busy);
  pickers.linkedPagesPicker.setDisabled(busy);
}

function resetForm(elements, pickers, state) {
  state.editingEventId = null;
  elements.createForm.reset();
  pickers.arcPicker.reset(null);
  pickers.locationPicker.reset(null);
  pickers.linkedPagesPicker.reset([]);
  elements.createStatusEl.textContent = '';
  syncFormMode(elements, state);
}

function populateForm(event, elements, pickers, state) {
  state.editingEventId = event.id;
  const fields = {
    title: event.title || '',
    summary: event.summary || '',
    eventType: event.eventType || '',
    tags: Array.isArray(event.tags) ? event.tags.join(', ') : '',
    ...extractDateFields(event.date?.start, 'start'),
    ...extractDateFields(event.date?.end, 'end'),
  };
  Object.entries(fields).forEach(([name, value]) => {
    const input = elements.createForm.elements.namedItem(name);
    if (input) input.value = value;
  });
  pickers.arcPicker.reset(event.arc || null);
  pickers.locationPicker.reset(event.location || null);
  pickers.linkedPagesPicker.reset(Array.isArray(event.linkedPages) ? event.linkedPages : []);
  syncFormMode(elements, state);
  elements.createStatusEl.textContent = `Editing "${event.title}"`;
  elements.formHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function bindFilterControls(elements, state, onChange) {
  [elements.typeEl, elements.arcEl, elements.locationEl, elements.tagEl, elements.archivedEl].forEach((el) => {
    el?.addEventListener('change', () => {
      state.filters.eventType = elements.typeEl.value;
      state.filters.arcPageId = elements.arcEl.value;
      state.filters.locationPageId = elements.locationEl.value;
      state.filters.tag = elements.tagEl.value;
      state.filters.archived = elements.archivedEl.value;
      void onChange();
    });
  });
}

export async function render(container) {
  const state = createTimelineState();

  container.innerHTML = renderTimelineShell();

  const elements = {
    typeEl: container.querySelector('#timelineTypeFilter'),
    arcEl: container.querySelector('#timelineArcFilter'),
    locationEl: container.querySelector('#timelineLocationFilter'),
    tagEl: container.querySelector('#timelineTagFilter'),
    archivedEl: container.querySelector('#timelineArchivedFilter'),
    summaryEl: container.querySelector('#timelineSummary'),
    listEl: container.querySelector('#timelineList'),
    createForm: container.querySelector('#timelineCreateForm'),
    createStatusEl: container.querySelector('#timelineCreateStatus'),
    formHeading: container.querySelector('#timelineFormHeading'),
    formSubheading: container.querySelector('#timelineFormSubheading'),
    submitButton: container.querySelector('#timelineSubmitButton'),
    cancelEdit: container.querySelector('#timelineCancelEdit'),
  };

  const pickers = {
    arcPicker: mountTimelinePagePicker(container.querySelector('#timelineArcPicker'), {
      placeholder: 'Search arc pages…',
      multiple: false,
    }),
    locationPicker: mountTimelinePagePicker(container.querySelector('#timelineLocationPicker'), {
      placeholder: 'Search location pages…',
      multiple: false,
    }),
    linkedPagesPicker: mountTimelinePagePicker(container.querySelector('#timelineLinkedPagesPicker'), {
      placeholder: 'Search related pages…',
      multiple: true,
    }),
  };

  async function load() {
    elements.summaryEl.textContent = 'Loading…';
    elements.listEl.innerHTML = '';
    try {
      const payload = await fetchTimeline(state.filters);
      const events = Array.isArray(payload?.events) ? payload.events : [];
      state.eventsById = new Map(events.map((event) => [String(event.id), event]));
      applyFilterOptions(elements, payload?.filters || {}, state.filters);
      elements.summaryEl.textContent = `${events.length} event${events.length === 1 ? '' : 's'} shown`;
      renderTimelineList(elements.listEl, events);
    } catch (error) {
      elements.summaryEl.textContent = 'Timeline failed to load.';
      elements.listEl.innerHTML = `<section class="card"><p class="meta" style="margin:0;">${escapeHtml(error?.message || 'Unknown error')}</p></section>`;
    }
  }

  async function submitForm(event) {
    event.preventDefault();
    if (state.formBusy) return;
    const payload = getFormPayload(elements.createForm, pickers);
    const editingEventId = state.editingEventId;
    setBusy(elements, pickers, state, true, editingEventId ? 'Saving changes…' : 'Saving…');
    try {
      if (editingEventId) await updateTimelineEvent(editingEventId, payload);
      else await createTimelineEvent(payload);
      resetForm(elements, pickers, state);
      setBusy(elements, pickers, state, false, editingEventId ? 'Changes saved.' : 'Saved.');
      await load();
      window.setTimeout(() => {
        if (!state.formBusy && /saved/i.test(elements.createStatusEl.textContent || '')) elements.createStatusEl.textContent = '';
      }, 1600);
    } catch (error) {
      setBusy(elements, pickers, state, false, error?.message || 'Failed to save.');
      syncFormMode(elements, state);
    }
  }

  async function onListAction(event) {
    const button = event.target.closest('[data-timeline-action][data-event-id]');
    if (!button || state.formBusy) return;
    const action = button.getAttribute('data-timeline-action');
    const eventId = button.getAttribute('data-event-id');
    const timelineEvent = state.eventsById.get(String(eventId));
    if (!timelineEvent) return;

    if (action === 'edit') {
      populateForm(timelineEvent, elements, pickers, state);
      return;
    }

    if (action === 'archive') {
      const nextArchived = !timelineEvent.archivedAt;
      const label = nextArchived ? 'archive' : 'restore';
      if (!window.confirm(`Are you sure you want to ${label} "${timelineEvent.title}"?`)) return;
      setBusy(elements, pickers, state, true, nextArchived ? 'Archiving…' : 'Restoring…');
      try {
        await updateTimelineEvent(timelineEvent.id, { archived: nextArchived });
        if (state.editingEventId === timelineEvent.id && nextArchived && state.filters.archived === 'exclude') resetForm(elements, pickers, state);
        setBusy(elements, pickers, state, false, nextArchived ? 'Event archived.' : 'Event restored.');
        await load();
      } catch (error) {
        setBusy(elements, pickers, state, false, error?.message || 'Timeline update failed.');
        syncFormMode(elements, state);
      }
      return;
    }

    if (action === 'delete') {
      if (!window.confirm(`Delete "${timelineEvent.title}"? This cannot be undone.`)) return;
      setBusy(elements, pickers, state, true, 'Deleting…');
      try {
        await deleteTimelineEvent(timelineEvent.id);
        if (state.editingEventId === timelineEvent.id) resetForm(elements, pickers, state);
        setBusy(elements, pickers, state, false, 'Event deleted.');
        await load();
      } catch (error) {
        setBusy(elements, pickers, state, false, error?.message || 'Delete failed.');
        syncFormMode(elements, state);
      }
    }
  }

  bindFilterControls(elements, state, load);
  elements.createForm.addEventListener('submit', (event) => { void submitForm(event); });
  elements.createForm.addEventListener('reset', () => {
    window.setTimeout(() => {
      resetForm(elements, pickers, state);
    }, 0);
  });
  elements.cancelEdit.addEventListener('click', () => {
    resetForm(elements, pickers, state);
  });
  elements.listEl.addEventListener('click', (event) => {
    void onListAction(event);
  });

  syncFormMode(elements, state);
  await load();
}
