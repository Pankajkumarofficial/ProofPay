const FORBIDDEN = /^\$|\./;

function scrub(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  for (const key of Object.keys(value)) {
    if (FORBIDDEN.test(key)) {
      delete value[key];
      continue;
    }
    scrub(value[key], depth + 1);
  }
  return value;
}

/** Strips Mongo operator keys from user input so a crafted payload cannot reshape a query. */
export const sanitizeRequest = (req, _res, next) => {
  if (req.body) scrub(req.body);
  if (req.params) scrub(req.params);
  if (req.query) scrub(req.query);
  next();
};
