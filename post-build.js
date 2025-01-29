/* eslint-disable @typescript-eslint/no-var-requires */

const fs = require('node:fs');
const path = require('node:path');


const BUILD_DIR = path.resolve('./dist/');


(async function() {
  async function rimraf(pathname) {
    try {
      const stat = await fs.promises.stat(pathname);

      if(!stat.isDirectory()) {
        await fs.promises.unlink(pathname);
        return;
      }

      const contents = await fs.promises.readdir(pathname);

      for(const entry of contents) {
        const currentPath = path.join(pathname, entry);
        const currentStat = await fs.promises.stat(currentPath);

        if(currentStat.isDirectory()) {
          await rimraf(currentPath);
          continue;
        }

        try {
          await fs.promises.unlink(currentPath);
        } catch (err) {
          if(err.code === 'ENOENT') continue;
          throw err;
        }
      }
    } catch (err) {
      if(err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async function rrmp(pathname = BUILD_DIR, p) {
    try {
      const stat = await fs.promises.stat(pathname);
      if(!stat.isDirectory()) return;

      const contents = await fs.promises.readdir(pathname);

      for(const entry of contents) {
        const currentPath = path.join(pathname, entry);
        const currentStat = await fs.promises.stat(currentPath);

        if(currentStat.isDirectory()) {
          await rrmp(currentPath, p);
          continue;
        }

        if(!entry.endsWith('.js')) continue;
        
        const shouldDelete = p.filter(item => {
          if(item instanceof RegExp) return item.test(entry);
          return entry.endsWith(item);
        }).length > 0;

        if(shouldDelete) {
          await fs.promises.unlink(currentPath);
        }
      }
    } catch (err) {
      if(err.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  await rrmp(BUILD_DIR, [/\.spec\./, '.tmp', '.d.js', 'test.d.ts']);
  await rimraf(path.join(BUILD_DIR, '.vscode'));
  await rimraf(path.join(BUILD_DIR, '.editorconfig'));
})();
