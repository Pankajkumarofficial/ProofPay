/**
 * Local time, because these lines are read next to Vite's — which prints local
 * — in one terminal. A UTC stamp beside it put the two halves of the same
 * `npm run dev` hours apart, and made correlating a request with what the API
 * did about it a subtraction problem.
 */
const stamp = () => {
  const now = new Date();
  return `${now.toLocaleTimeString('en-GB', { hour12: false })}.${String(now.getMilliseconds()).padStart(3, '0')}`;
};

const write = (level, colour, args) => {
  // eslint-disable-next-line no-console
  console.log(`${colour}${stamp()} ${level}\x1b[0m`, ...args);
};

export const logger = {
  info: (...args) => write('INFO ', '\x1b[38;5;109m', args),
  warn: (...args) => write('WARN ', '\x1b[38;5;179m', args),
  error: (...args) => write('ERROR', '\x1b[38;5;167m', args),
  debug: (...args) => {
    if (process.env.NODE_ENV === 'production') return;
    write('DEBUG', '\x1b[38;5;245m', args);
  },
};
