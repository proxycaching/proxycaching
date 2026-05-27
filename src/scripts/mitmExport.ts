import path from 'path';
import os from 'os';
import { promises as fsPromises } from 'fs';
import { MitmInstaller } from '../mitmInstaller';
import { createLogger } from '../logger';

async function main() {
  const baseDir = path.join(process.cwd(), 'config');
  const logger = createLogger('info');

  try {
    const installer = new MitmInstaller(baseDir, logger);
    await installer.initialize();

    const exportDir = path.join(os.homedir(), 'Desktop');
    const exportPath = path.join(exportDir, 'mitm-proxy-ca.crt');

    await installer.exportCA(exportPath);

    console.log(`\n✓ CA certificate exported successfully!`);
    console.log(`  Location: ${exportPath}`);
    console.log('\nTo install manually:');
    console.log('  Windows: Double-click the file and select "Install Certificate"');
    console.log('  macOS:   Double-click to add to Keychain');
    console.log('  Linux:   Copy to /usr/local/share/ca-certificates/ and run update-ca-certificates\n');
  } catch (error) {
    console.error('✗ Error:', String(error));
    process.exit(1);
  }
}

main();
