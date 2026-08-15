/**
 * Guard against module-scope environment reads.
 *
 * `const X = process.env.SOMETHING` at the top of a module is resolved once,
 * when the module first loads. Next resolves those at build time, and Vercel
 * withholds variables marked "Sensitive" from the build — so the constant
 * freezes as undefined and no amount of correct configuration will revive it.
 *
 * That is exactly how the Google Sheet integration broke: GOOGLE_SHEET_ID was
 * read at module scope while the other two credentials were read inside
 * functions, so the app served the bundled snapshot forever while reporting
 * that the Sheet "isn't connected yet".
 *
 * Read environment variables inside the function that needs them.
 *
 *   node test_env.mjs
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOTS = ["lib", "app", "components"];
const failures = [];
let scanned = 0;

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walk(p));
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** Strip block and line comments so prose about process.env isn't flagged. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

for (const root of ROOTS) {
  let files;
  try {
    files = walk(root);
  } catch {
    continue;
  }

  for (const file of files) {
    scanned++;
    const lines = stripComments(readFileSync(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      // Module scope means column zero — anything indented is inside a
      // function, class or object and is re-evaluated when that runs.
      if (/^(const|let|var)\s+[\w$]+\s*=\s*process\.env\b/.test(line)) {
        failures.push(`${file}:${i + 1}  ${line.trim()}`);
      }
    });
  }
}

console.log(`scanned ${scanned} files under ${ROOTS.join(", ")}`);

if (failures.length) {
  console.log(`\nFAIL  ${failures.length} module-scope env read(s):\n`);
  for (const f of failures) console.log("  " + f);
  console.log(
    "\nMove these inside the function that uses them — a build-time read\n" +
      "cannot see a runtime-only (Sensitive) variable."
  );
  process.exit(1);
}

console.log("PASS  no module-scope environment reads");
