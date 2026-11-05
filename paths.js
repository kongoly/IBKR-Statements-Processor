// ============================================================
// paths.js — Where your private files live
// ============================================================
// The IBKR token, the Google Sheet ID and the Google key file are
// kept OUTSIDE the project folder, so they can never be uploaded
// to GitHub by mistake. This file finds them.
//
// The locations are read from paths.json (in this folder). That file
// is personal and gitignored. To create yours, copy
// paths.example.json to paths.json and change the paths.
//
// If there is no paths.json, the default is a ".secrets" folder in
// your home folder (e.g. C:\Users\<you>\.secrets).
// ============================================================
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const DEFAULT_DIR = path.join(os.homedir(), '.secrets');
const CONFIG_FILE = path.join(__dirname, 'paths.json');

let config = {};
if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    console.error('paths.json could not be read (is it valid JSON?): ' + e.message);
  }
}

const envFile       = config.envFile       || path.join(DEFAULT_DIR, '.env');
const googleKeyFile = config.googleKeyFile || path.join(DEFAULT_DIR, 'credentials.json');

// Load the .env file (IBKR_FLEX_TOKEN, IBKR_FLEX_QUERY_ID, GOOGLE_SHEET_ID) into process.env.
// Only the file's location is ever printed, never what's inside it.
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
} else {
  console.log(`No .env file at ${envFile}: "Fetch from IBKR" and "Send to Sheets" won't work until it exists (see paths.example.json).`);
}

module.exports = { envFile, googleKeyFile };
