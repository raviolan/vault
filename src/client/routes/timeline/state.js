export function createTimelineState() {
  return {
    filters: {
      eventType: '',
      arcPageId: '',
      locationPageId: '',
      tag: '',
      archived: 'exclude',
    },
    editingEventId: null,
    formBusy: false,
    eventsById: new Map(),
  };
}

export function parseTags(text) {
  return String(text || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function extractDateFields(datePart, prefix) {
  return {
    [`${prefix}Precision`]: datePart?.precision || (prefix === 'start' ? 'day' : ''),
    [`${prefix}Year`]: datePart?.year == null ? '' : String(datePart.year),
    [`${prefix}Month`]: datePart?.month == null ? '' : String(datePart.month),
    [`${prefix}Day`]: datePart?.day == null ? '' : String(datePart.day),
  };
}
