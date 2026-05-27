import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import crypto from 'crypto';
import forge from 'node-forge';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { Logger } from './logger';

const execAsync = promisify(exec);

export interface CAInfo {
  keyPath: string;
  certPath: string;
  fingerprint: string;
  isTrusted: boolean;
}

export class CAManager {
  private mitmDir: string;
  private proxyCaDir: string;
  private keyPath: string;
  private certPath: string;
  private logger?: Logger;

  constructor(baseDir: string, logger?: Logger) {
    this.mitmDir = path.join(baseDir, 'mitm');
    this.proxyCaDir = path.join(baseDir, 'mitm', 'proxy-ca');
    this.keyPath = path.join(this.proxyCaDir, 'keys', 'ca.private.key');
    this.certPath = path.join(this.proxyCaDir, 'certs', 'ca.pem');
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    // Ensure the proxy CA directory exists so the proxy can create the
    // CA files in a predictable place. We do not generate CA material here.
    await fsPromises.mkdir(this.proxyCaDir, { recursive: true });
    if (!process.platform.startsWith('win')) {
      try {
        await fsPromises.chmod(this.mitmDir, 0o700);
      } catch {
        // ignore permission errors
      }
    }
  }

  async hasCA(): Promise<boolean> {
    try {
      const keyExists = fs.existsSync(this.keyPath);
      const certExists = fs.existsSync(this.certPath);
      return keyExists && certExists;
    } catch {
      return false;
    }
  }

  async generateCA(): Promise<void> {
    // Generation of a CA is intentionally disabled. The runtime MITM proxy
    // (`http-mitm-proxy`) manages CA creation inside `sslCaDir` and will
    // create the canonical CA files used at runtime. Scripts must not
    // generate alternate CA material to avoid trust/consistency issues.
    this.logger?.warn('generateCA() called, but CA generation is disabled. Start the proxy to create the CA.');
    throw new Error('CA generation disabled: start the MITM proxy to create the CA files in the proxy CA directory.');
  }

  async getFingerprint(): Promise<string> {
    if (!(await this.hasCA())) {
      throw new Error('CA certificate not found.');
    }

    try {
      const certPem = await fsPromises.readFile(this.certPath, 'utf-8');
      const cert = forge.pki.certificateFromPem(certPem);
      const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
      const hash = crypto.createHash('sha256').update(Buffer.from(derBytes, 'binary')).digest('hex');
      return hash.toUpperCase().match(/.{1,2}/g)?.join(':') || hash.toUpperCase();
    } catch (error) {
      this.logger?.error('Failed to compute CA fingerprint', { error: String(error) });
      throw error;
    }
  }

  async getCAInfo(): Promise<CAInfo> {
    const hasCA = await this.hasCA();
    if (!hasCA) {
      throw new Error('CA not initialized.');
    }

    const fingerprint = await this.getFingerprint();
    const isTrusted = await this.isCATrusted();

    return {
      keyPath: this.keyPath,
      certPath: this.certPath,
      fingerprint,
      isTrusted,
    };
  }

  async exportCA(exportPath: string): Promise<void> {
    if (!(await this.hasCA())) {
      throw new Error('CA certificate not found.');
    }

    try {
      const certData = await fsPromises.readFile(this.certPath, 'utf-8');
      await fsPromises.writeFile(exportPath, certData, 'utf-8');
      this.logger?.info('CA certificate exported', { exportPath });
    } catch (error) {
      this.logger?.error('Failed to export CA certificate', { error: String(error) });
      throw error;
    }
  }

  private async isCATrusted(): Promise<boolean> {
    if (process.platform === 'win32') {
      try {
        const certPem = await fsPromises.readFile(this.certPath, 'utf-8');
        const cert = forge.pki.certificateFromPem(certPem);
        const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
        const thumbprint = crypto.createHash('sha1').update(Buffer.from(derBytes, 'binary')).digest('hex').toUpperCase();
        const { stdout } = await execAsync(
          `powershell -NoProfile -Command "Get-ChildItem -Path Cert:\\LocalMachine\\Root | Where-Object {$_.Thumbprint -eq '${thumbprint}'} | Select-Object -ExpandProperty Thumbprint"`
        );
        return !!stdout.trim();
      } catch {
        return false;
      }
    } else if (process.platform === 'darwin') {
      try {
        const { stdout } = await execAsync(`security find-certificate -c localhost /Library/Keychains/System.keychain`);
        return !!stdout.trim();
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }

  private async askUserConfirmationWindows(): Promise<boolean> {
    const scriptPath = path.join(this.mitmDir, 'install_ca_confirmation.ps1');
    const scriptContent = `try {
    Add-Type -AssemblyName PresentationFramework
    $text = @'
Installing the Proxycaching CA will allow the proxy to intercept HTTPS traffic.

Only proceed if you trust this application.

Do you want to install the CA now?
'@
    $title = 'Proxycaching Certificate Installation'
    $result = [System.Windows.MessageBox]::Show($text, $title, [System.Windows.MessageBoxButton]::YesNo, [System.Windows.MessageBoxImage]::Information)
    if ($result -eq [System.Windows.MessageBoxResult]::Yes) { exit 0 } else { exit 1 }
} catch {
    exit 1
}`;

    try {
      await fsPromises.writeFile(scriptPath, scriptContent, { encoding: 'utf8' });
      await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -WindowStyle hidden`);
      return true;
    } catch (error) {
      this.logger?.warn('User confirmation dialog failed or was dismissed', { error: String(error) });
      return false;
    } finally {
      await fsPromises.unlink(scriptPath).catch(() => {});
    }
  }

  async installCAWindows(): Promise<void> {
    if (process.platform !== 'win32') {
      throw new Error('Windows installer can only run on Windows.');
    }

    if (!(await this.hasCA())) {
      throw new Error('CA certificate not found.');
    }
    // Prefer prompting for elevation immediately so the user sees a UAC prompt
    // and can approve the install in one click. Construct the Import-Certificate
    // command and run it elevated.
    const certPath = this.certPath.replace(/'/g, "''");
    const psCommand = `Import-Certificate -FilePath '${certPath}' -CertStoreLocation Cert:\\LocalMachine\\Root -ErrorAction Stop`;

    try {
      // Show a user-facing message before triggering UAC so they understand why
      // the elevation prompt is appearing.
      const confirmed = await this.askUserConfirmationWindows();
      if (!confirmed) {
        this.logger?.info('User declined CA installation via confirmation dialog.');
        throw new Error('User declined CA installation');
      }

      await this.installCAWindowsElevated(psCommand);
      this.logger?.info('CA installed to Windows trusted root store (elevated).');
      return;
    } catch (error) {
      this.logger?.error('Elevated Windows CA install failed', { error: String(error) });
      throw error;
    }
  }

  private async installCAWindowsElevated(psCommand: string): Promise<void> {
    this.logger?.info('Requesting elevated privileges for Windows CA installation.');

    const scriptPath = path.join(this.mitmDir, 'install_ca_elevated.ps1');

    // Create a PowerShell script that imports the cert; running a script via Start-Process
    // with -Verb RunAs is more reliable for prompting UAC.
    const certPathSingleQuoted = this.certPath.replace(/'/g, "''");
    const scriptContent = `try {
    Import-Certificate -FilePath '${certPathSingleQuoted}' -CertStoreLocation Cert:\\\\LocalMachine\\\\Root -ErrorAction Stop
    Write-Output 'MITM_CA_INSTALL_OK'
} catch {
    Write-Error $_.Exception.Message
    exit 1
}`;

    try {
      await fsPromises.writeFile(scriptPath, scriptContent, { encoding: 'utf8' });
    } catch (err) {
      this.logger?.error('Failed to write elevated install script', { error: String(err) });
      throw err;
    }

    return new Promise<void>((resolve, reject) => {
      const startProcessCmd = `Start-Process -FilePath powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptPath.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle hidden`;

      const args = ['-NoProfile', '-Command', startProcessCmd];
      const proc = spawn('powershell.exe', args, { stdio: 'inherit' });

      proc.on('error', (spawnError) => reject(spawnError));
      proc.on('exit', async (code) => {
        try {
          // cleanup script
          await fsPromises.unlink(scriptPath).catch(() => {});
        } catch (cleanupErr) {
          this.logger?.warn('Failed to remove temporary install script', { error: String(cleanupErr) });
        }

        if (code === 0) {
          this.logger?.info('Elevated CA installation process exited with code 0');
          resolve();
        } else {
          reject(new Error(`Elevated PowerShell exited with code ${code}`));
        }
      });
    }).then(() => {
      this.logger?.info('Elevated CA installation completed successfully.');
    }).catch((error) => {
      this.logger?.error('Elevated CA installation failed', { error: String(error) });
      throw error;
    });
  }

  async installCAMac(): Promise<void> {
    if (process.platform !== 'darwin') {
      throw new Error('macOS installer can only run on macOS.');
    }

    if (!(await this.hasCA())) {
      throw new Error('CA certificate not found.');
    }

    const certPath = this.certPath.replace(/'/g, "\\'");
    const cmd = `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain '${certPath}'`;

    try {
      await execAsync(cmd);
      this.logger?.info('CA installed to macOS Keychain');
    } catch (error) {
      this.logger?.error('Failed to install CA to macOS Keychain', { error: String(error) });
      throw error;
    }
  }

  async installCALinux(): Promise<void> {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      throw new Error('Linux installer cannot run on this platform.');
    }

    if (!(await this.hasCA())) {
      throw new Error('CA certificate not found.');
    }

    const certPath = this.certPath;
    const targetPath = `/usr/local/share/ca-certificates/mitm-proxy-ca.crt`;
    const updateCmd = 'sudo update-ca-certificates';

    try {
      await execAsync(`sudo cp '${certPath}' ${targetPath}`);
      await execAsync(updateCmd);
      this.logger?.info('CA installed to Linux certificate store');
    } catch (error) {
      this.logger?.error('Failed to install CA to Linux store', { error: String(error) });
      throw error;
    }
  }
}
