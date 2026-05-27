import { CAManager } from './caManager';
import { Logger } from './logger';

export class MitmInstaller {
  private caManager: CAManager;
  private logger: Logger;

  constructor(configDir: string, logger: Logger) {
    this.caManager = new CAManager(configDir, logger);
    this.logger = logger;
  }

  async initialize(): Promise<void> {
    await this.caManager.initialize();
  }

  async ensureCAExists(): Promise<void> {
    const hasCA = await this.caManager.hasCA();
    if (!hasCA) {
      // Do not generate a CA here. The MITM proxy creates the CA at
      // runtime in the proxy CA directory. Ask the caller to start the
      // proxy which will create the CA files, then re-run the installer.
      throw new Error('Proxy CA not found. Start the MITM proxy to create the CA files before running installer actions.');
    }
  }

  async getCAFingerprint(): Promise<string> {
    return this.caManager.getFingerprint();
  }

  async getCAInfo() {
    return this.caManager.getCAInfo();
  }

  async exportCA(exportPath: string): Promise<void> {
    return this.caManager.exportCA(exportPath);
  }

  async ensureProxyCAFiles(): Promise<void> {
    return this.caManager.ensureProxyCAFiles();
  }

  async ensureCAInstalled(): Promise<void> {
    if (process.platform !== 'win32') {
      return;
    }

    const caInfo = await this.getCAInfo();
    if (caInfo.isTrusted) {
      return;
    }

    await this.installCA();
  }

  async installCA(): Promise<string> {
    const platform = process.platform;

    try {
      if (platform === 'win32') {
        await this.caManager.installCAWindows();
        return 'CA installed successfully to Windows Trusted Root store.';
      } else if (platform === 'darwin') {
        await this.caManager.installCAMac();
        return 'CA installed successfully to macOS Keychain. You may need to restart your browser.';
      } else {
        await this.caManager.installCALinux();
        return 'CA installed successfully. Update Firefox certificate store manually if needed.';
      }
    } catch (error) {
      const msg = `CA installation failed: ${String(error)}`;
      this.logger.error('MITM installer error', { error: String(error) });
      throw new Error(msg);
    }
  }

  logFirstRunInstructions(): void {
    this.logger.info('\n'+
      '╔════════════════════════════════════════════════════════════════════╗\n' +
      '║ MITM HTTPS Caching Enabled - CA Certificate Installation Required ║\n' +
      '╚════════════════════════════════════════════════════════════════════╝\n' +
      '\nTo intercept and cache HTTPS traffic, install the CA certificate:\n' +
      '\n  Windows (Admin PowerShell):\n' +
      '    npm run mitm-install\n' +
      '\n  macOS:\n' +
      '    npm run mitm-export  # Then double-click the cert to add to Keychain\n' +
      '\n  Linux:\n' +
      '    npm run mitm-export  # Then copy to /usr/local/share/ca-certificates/\n' +
      '    sudo update-ca-certificates\n' +
      '\nCA Fingerprint for verification: Check the admin UI at http://localhost:8081/'
    );
  }
}
