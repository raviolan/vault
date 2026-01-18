export const WEATHER_APP_ID = 'weather';

export const DEFAULT_UNIT = 'C';
export const UNITS = ['C', 'F'];

export const SEASONS = ['none', 'spring', 'summer', 'autumn', 'winter'];

// Season presets define included base weather ids; 'none' uses enabled list as-is
// These ids must match base catalog ids in engine.js
export const PRESETS = {
  none: { label: 'None', included: null },
  spring: { label: 'Spring', included: ['clear', 'partly', 'cloudy', 'light_rain', 'heavy_rain', 'fog'] },
  summer: { label: 'Summer', included: ['clear', 'partly', 'cloudy', 'light_rain', 'thunder'] },
  autumn: { label: 'Autumn', included: ['partly', 'cloudy', 'light_rain', 'heavy_rain', 'fog'] },
  winter: { label: 'Winter', included: ['cloudy', 'fog', 'snow'] },
};

// CSS class name mapping used by components.css gradients
export function classForWeather(id) {
  return `wc-${id}`; // e.g., clear => wc-clear
}
