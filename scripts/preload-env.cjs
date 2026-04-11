/**
 * Loads env for CLI scripts (tsx seed, etc.) so they match Next.js precedence:
 * `.env.local` then `.env` in the project root.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const root = path.join(__dirname, '..');
const localPath = path.join(root, '.env.local');
const envPath = path.join(root, '.env');

if (fs.existsSync(localPath)) {
  dotenv.config({ path: localPath });
}
dotenv.config({ path: envPath });
