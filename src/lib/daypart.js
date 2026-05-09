// src/lib/daypart.js — Centralized daypart system
//
// ALL time-of-day phrasing in Jiff derives from this single source of truth.
// Uses LOCAL device time.
//
// Buckets:
//   morning   5:00 – 10:59
//   afternoon 11:00 – 15:59
//   evening   16:00 – 19:59
//   night     20:00 – 4:59
//
// NO component or copy should hardcode "tonight" or any daypart word directly.

/**
 * Returns the current daypart string: 'morning' | 'afternoon' | 'evening' | 'night'
 */
export function getDaypart(hoursOverride) {
  const h = hoursOverride !== undefined ? hoursOverride : new Date().getHours();
  if (h >= 5  && h < 11) return 'morning';
  if (h >= 11 && h < 16) return 'afternoon';
  if (h >= 16 && h < 20) return 'evening';
  return 'night'; // 20:00 – 4:59
}

/**
 * Greeting word for the given daypart.
 * @returns 'morning' | 'afternoon' | 'evening' | 'night'
 */
export function greetWord(dp) {
  const d = dp || getDaypart();
  return d === 'morning' ? 'morning' : d === 'afternoon' ? 'afternoon' : 'evening';
}

/**
 * Meal period phrase — used in recommendation framing.
 * Short, calm, non-presumptuous.
 */
export const MEAL_PERIOD = {
  morning:   'this morning',
  afternoon: 'for the afternoon',
  evening:   'this evening',
  night:     'for tonight',
};

/**
 * CTA cook phrase — verb + period. Used in primary CTA buttons.
 */
export const COOK_CTA = {
  morning:   'Cook this for breakfast →',
  afternoon: 'Cook this for lunch →',
  evening:   'Cook this for dinner →',
  night:     'Make this tonight →',
};

/**
 * Dismiss phrase — used in "not this" secondary action.
 */
export const DISMISS_CTA = {
  morning:   'Not this morning',
  afternoon: 'Not for lunch',
  evening:   'Not tonight',
  night:     'Not tonight',
};

/**
 * Framing line suffix — used in why.line2 and MealCard framing.
 * Short context for the recommendation.
 */
export const FRAMING = {
  quick: {
    morning:   'Light and quick for the morning',
    afternoon: 'Light and easy for the afternoon',
    evening:   'Quick and easy this evening',
    night:     'Quick and comforting tonight',
  },
  moderate: {
    morning:   'Warm and filling to start the day',
    afternoon: 'Satisfying midday meal',
    evening:   'Comforting and easy this evening',
    night:     'A comforting end-of-day meal',
  },
  involved: {
    morning:   'Worth the effort this morning',
    afternoon: 'Worth the effort today',
    evening:   'Worth making this evening',
    night:     'Worth the effort tonight',
  },
};

/**
 * Returns the correct framing line for a given effort level and daypart.
 * effort: 'quick' | 'moderate' | 'involved'
 */
export function getFramingLine(effort, dp) {
  const d = dp || getDaypart();
  const e = effort === 'Very quick' ? 'quick'
           : effort === 'Easy'       ? 'quick'
           : effort === 'Moderate'   ? 'moderate'
           : 'involved';
  return FRAMING[e][d];
}
