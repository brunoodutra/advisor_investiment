/**
 * Fetches cryptocurrency SVG icons and saves them into assets/icons.
 * - Reads symbols from config.js (CONFIG.cryptos).
 * - Downloads missing icons from the Cryptofonts reference URL.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

/**
 * Reads project crypto symbols from config.js using a simple regex.
 * @returns {string[]} Array of unique crypto symbols.
 */
function readSymbolsFromConfig() {
  const projectRoot = path.resolve(__dirname, '..');
  const configPath = path.join(projectRoot, 'config.js');
  const content = fs.readFileSync(configPath, 'utf8');
  const matches = [...content.matchAll(/symbol:\s*['"]([A-Za-z0-9]+)['"]/g)];
  const symbols = Array.from(new Set(matches.map(m => m[1])));
  return symbols;
}

/**
 * Ensures the icons directory exists.
 * @returns {string} Absolute path to assets/icons directory.
 */
function ensureIconsDir() {
  const iconsDir = path.resolve(__dirname, '..', 'assets', 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });
  return iconsDir;
}

/**
 * Downloads a file via HTTPS.
 * @param {string} url Remote file URL.
 * @param {string} dest Destination file path.
 * @returns {Promise<void>} Resolves when saved, rejects on errors.
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    }).on('error', reject);
  });
}

/**
 * Builds remote icon URL for a given symbol.
 * @param {string} symbol Crypto symbol.
 * @returns {string} Remote SVG URL.
 */
function buildRemoteUrl(symbol) {
  const lower = String(symbol).toLowerCase();
  return `https://raw.githubusercontent.com/Cryptofonts/cryptoicons/refs/heads/master/SVG/${lower}.svg`;
}

/**
 * Main: download missing icons to assets/icons.
 */
async function main() {
  const iconsDir = ensureIconsDir();
  const symbols = readSymbolsFromConfig();
  console.log(`Found ${symbols.length} symbol(s):`, symbols.join(', '));

  const tasks = symbols.map(async (sym) => {
    const lower = sym.toLowerCase();
    const dest = path.join(iconsDir, `${lower}.svg`);
    if (fs.existsSync(dest)) {
      console.log(`[skip] ${lower}.svg already exists`);
      return;
    }
    const url = buildRemoteUrl(sym);
    try {
      console.log(`[fetch] ${url} -> assets/icons/${lower}.svg`);
      await downloadFile(url, dest);
      console.log(`[done] ${lower}.svg saved`);
    } catch (err) {
      console.error(`[fail] ${lower}.svg`, err.message);
    }
  });

  await Promise.allSettled(tasks);
  console.log('Icon fetch completed.');
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});