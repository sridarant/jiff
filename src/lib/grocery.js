// src/lib/grocery.js — Grocery list building and ingredient matching
// Pure functions — no React dependencies.

const STOP_WORDS = new Set([
  'g','kg','ml','l','oz','lb','tbsp','tsp','cup','cups',
  'cloves','clove','piece','pieces','slice','slices',
  'medium','large','small','fresh','dried','minced',
  'chopped','diced','sliced','grated','handful','pinch',
  'bunch','can','cans','tin','tins','pack','packet',
  'to','taste','of',
]);

/**
 * Extract the core ingredient name from a full ingredient string.
 * Removes quantities, units, prep instructions, and asterisks.
 * e.g. "2 tbsp *olive oil, chopped" → "olive oil"
 */
export function extractCoreName(str) {
  return str
    .toLowerCase()
    .replace(/^\*?\s*/, '')
    .replace(/[\d¼½¾⅓⅔⅛]+[\s-]*/g, '')
    .replace(
      /\b(g|kg|ml|l|oz|lb|tbsp|tsp|cup|cups|cloves?|piece|pieces|slice|slices|medium|large|small|fresh|dried|minced|chopped|diced|sliced|grated|handful|pinch|bunch|can|cans|tin|tins|pack|packet|to taste|of)\b/gi,
      ''
    )
    .replace(/[,()]/g, '')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOP_WORDS.has(w))
    .join(' ');
}

/**
 * Check if a core ingredient name is available in the user's fridge list.
 * Uses substring matching in both directions for flexibility.
 */
export function isAvailable(core, fridge) {
  const r = core.toLowerCase();
  return fridge.some(f => {
    const fr = f.toLowerCase().trim();
    return r.includes(fr) || fr.includes(r) ||
      fr.split(' ').some(w => w.length > 2 && r.includes(w));
  });
}

/**
 * Split a meal's ingredient list into "have" and "need" lists,
 * based on what's in the user's fridge.
 * Returns { need: string[], have: string[] }
 */
export function buildGroceryList(ingredients, fridge) {
  const safeIngredients = Array.isArray(ingredients) ? ingredients : [];
  const need = [], have = [];
  safeIngredients.forEach(ing => {
    const core = extractCoreName(ing);
    if (!core) return;
    const clean = ing.replace(/^\*\s*/, '');
    if (isAvailable(core, fridge)) {
      have.push(clean);
    } else {
      need.push(clean);
    }
  });
  return { need, have };
}
