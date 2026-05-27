import path from 'path';
import { MitmInstaller } from '../mitmInstaller';
import { createLogger } from '../logger';

async function main() {
  const baseDir = path.join(process.cwd(), 'config');
  const logger = createLogger('info');

  if (process.platform !== 'win32') {
    console.error('✗ This script is Windows-only.');
    process.exit(1);
  }

  try {
    console.log('Installing MITM CA to Windows Trusted Root store...\n');
    const installer = new MitmInstaller(baseDir, logger);
    await installer.initialize();

    const result = await installer.installCA();
    console.log(`✓ ${result}`);
    console.log('\nCA certificate is now trusted on this system.');
    console.log('HTTPS traffic will be intercepted and cached by the proxy.\n');
  } catch (error) {
    const errMsg = String(error);
    console.error('✗ Installation failed:', errMsg);

    if (errMsg.includes('Access denied') || errMsg.includes('permission')) {
      console.log('\nTo install the CA certificate, you need administrator privileges.');
      console.log('Please run this command in an elevated PowerShell or Command Prompt.');
    }

    process.exit(1);
  }
}

main();
