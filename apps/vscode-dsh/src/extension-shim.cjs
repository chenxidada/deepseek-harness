/**
 * CJS shim for VS Code extension host.
 * VS Code requires CommonJS for the `main` entry, but the bundled extension
 * uses ESM (for `import.meta` support). This shim bridges the two via
 * dynamic `import()`.
 */
let esmModule;

async function loadEsm() {
  if (!esmModule) {
    esmModule = await import('./extension.esm.mjs');
  }
  return esmModule;
}

async function activate(context) {
  const mod = await loadEsm();
  return mod.activate(context);
}

async function deactivate() {
  const mod = await loadEsm();
  if (mod.deactivate) {
    return mod.deactivate();
  }
}

module.exports = { activate, deactivate };
