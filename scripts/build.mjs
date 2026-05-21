import { access, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const requiredFiles = [
  "index.html",
  "admin.html",
  "styles.css",
  "vercel.json",
  "api/orders.js",
  "api/orders/[id]/status.js",
  "src/customer/app.js",
  "src/admin/app.js",
  "src/server/order-service.mjs",
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

for (const file of requiredFiles) {
  await access(file);
}

const vercelConfig = JSON.parse(await readFile("vercel.json", "utf8"));
const hasAdminRoute = vercelConfig.rewrites?.some((rewrite) => rewrite.source === "/admin" && rewrite.destination === "/admin.html");
if (!hasAdminRoute) throw new Error("vercel.json must rewrite /admin to /admin.html");

await writeFile(
  "config.js",
  `window.GIROS_SUPABASE_URL = ${JSON.stringify(process.env.GIROS_SUPABASE_URL || "")};
window.GIROS_SUPABASE_ANON_KEY = ${JSON.stringify(process.env.GIROS_SUPABASE_ANON_KEY || "")};
`,
);

await run(process.execPath, [
  "--check",
  "server.mjs",
]);
await run(process.execPath, ["--check", "src/customer/app.js"]);
await run(process.execPath, ["--check", "src/admin/app.js"]);
await run(process.execPath, ["--check", "src/shared/store.js"]);
await run(process.execPath, ["--check", "src/server/order-service.mjs"]);
await run(process.execPath, ["--check", "api/orders.js"]);
await run(process.execPath, ["--check", "api/orders/[id]/status.js"]);

console.log("Build verification passed. Static app and Vercel API functions are ready.");
