import { readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export class Installation {
  constructor({root=dirname(dirname(fileURLToPath(import.meta.url))),platform=process.platform,launch=spawn}={}) { this.root=resolve(root);this.platform=platform;this.launch=launch; }
  async status() {
    if(this.platform!=='win32')return {canUninstall:false};
    try {
      const receipt=JSON.parse((await readFile(join(this.root,'installed.json'),'utf8')).replace(/^\uFEFF/,''));
      const script=join(this.root,'Uninstall-Playlist-Wizard.ps1');
      if(receipt.product!=='rbxport-playlist-wizard'||receipt.schema!==1||resolve(receipt.installDirectory).toLowerCase()!==this.root.toLowerCase()||!(await lstat(script)).isFile()||(await realpath(this.root)).toLowerCase()!==this.root.toLowerCase())throw Error('Not managed');
      return {canUninstall:true,version:receipt.version};
    } catch { return {canUninstall:false}; }
  }
  async uninstall() {
    if(!(await this.status()).canUninstall)throw Error('Install with the single-file setup to enable managed uninstall.');
    const executable=join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const child=this.launch(executable,['-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',join(this.root,'Uninstall-Playlist-Wizard.ps1'),'-Confirmed','-WaitForProcessId',String(process.pid)],{windowsHide:true,detached:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});
    child.unref();return {started:true};
  }
}
