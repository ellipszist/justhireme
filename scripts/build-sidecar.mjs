import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(repoRoot, "backend");
const resourcesDir = join(repoRoot, "src-tauri", "resources");
const sidecarDir = join(resourcesDir, "backend");
const distDir = join(repoRoot, ".codex-temp-sidecar");
const builtSidecarDir = join(distDir, "backend");
const workPath = join(backendDir, "build_cache");
const pyinstallerConfigDir = join(backendDir, ".pyinstaller-cache");
const python = process.platform === "win32"
  ? join(backendDir, ".venv", "Scripts", "python.exe")
  : join(backendDir, ".venv", "bin", "python");

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: {
        ...process.env,
        UV_CACHE_DIR: join(backendDir, ".uv-cache"),
        PYTHONNOUSERSITE: "1",
        PYINSTALLER_CONFIG_DIR: pyinstallerConfigDir,
        HF_HOME: join(backendDir, ".hf-cache"),
      },
      shell: true,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function getRustTriple() {
  return new Promise((resolveTriple, reject) => {
    const child = spawn("rustc", ["-vV"], {
      cwd: repoRoot,
      shell: true,
      stdio: ["ignore", "pipe", "inherit"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`rustc -vV exited with code ${code}`));
        return;
      }
      const host = output.match(/^host:\s*(.+)$/m)?.[1]?.trim();
      if (!host) {
        reject(new Error("Could not read host triple from rustc -vV"));
        return;
      }
      resolveTriple(host);
    });
  });
}

const pyinstallerArgs = [
  "-m",
  "PyInstaller",
  "backend.spec",
  "--noconfirm",
  "--distpath",
  distDir,
  "--workpath",
  workPath,
];

if (!existsSync(python)) {
  throw new Error(`Python virtual environment not found: ${python}`);
}

rmSync(distDir, { recursive: true, force: true });
rmSync(join(workPath, "backend", "backend.pkg"), { force: true });
mkdirSync(distDir, { recursive: true });
await run(python, pyinstallerArgs, { cwd: backendDir });

const triple = await getRustTriple();
const extension = process.platform === "win32" ? ".exe" : "";
const source = join(builtSidecarDir, `backend${extension}`);
const target = join(sidecarDir, `jhm-sidecar-${triple}${extension}`);

if (!existsSync(source)) {
  throw new Error(`Expected PyInstaller sidecar was not created: ${source}`);
}

mkdirSync(sidecarDir, { recursive: true });
rmSync(join(sidecarDir, "_internal"), { recursive: true, force: true });
cpSync(join(builtSidecarDir, "_internal"), join(sidecarDir, "_internal"), { recursive: true });
copyFileSync(source, join(sidecarDir, `backend${extension}`));
copyFileSync(source, target);
console.log(`Sidecar ready: ${target}`);
