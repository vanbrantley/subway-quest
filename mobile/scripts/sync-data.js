/* eslint-disable no-undef */
/**
 * Copies the precomputed static JSON files from ../data/processed
 * into src/data/, so the app always bundles the latest pipeline output.
 *
 * Run this any time build_static_data.py has been re-run with fresh
 * MTA/GTFS source data.
 *
 * Usage: node scripts/sync-data.js
 */
const fs = require("fs");
const path = require("path");

const SOURCE_DIR = path.join(__dirname, "..", "..", "data", "processed");
const DEST_DIR = path.join(__dirname, "..", "data");

const FILES = ["stations.json", "route_stops.json", "route_shapes.json", "transfers.json"];

fs.mkdirSync(DEST_DIR, { recursive: true });

for (const file of FILES) {
    const src = path.join(SOURCE_DIR, file);
    const dest = path.join(DEST_DIR, file);

    if (!fs.existsSync(src)) {
        console.error(`Missing source file: ${src}`);
        process.exitCode = 1;
        continue;
    }

    fs.copyFileSync(src, dest);
    const sizeKb = (fs.statSync(dest).size / 1024).toFixed(0);
    console.log(`Copied ${file} (${sizeKb} KB)`);
}