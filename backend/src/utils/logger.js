const stamp = () => new Date().toISOString().slice(11, 23);

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
