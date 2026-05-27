import path from 'path';
import { MitmInstaller } from '../mitmInstaller';
import { createLogger } from '../logger';

async function main() {
  const baseDir = path.join(process.cwd(), 'config');
  const logger = createLogger('info');

  try {
    const installer = new MitmInstaller(baseDir, logger);
    await installer.initialize();
    await installer.ensureCAExists();

    const caInfo = await installer.getCAInfo();
    console.log('\n✓ MITM CA initialized successfully!');
    console.log(`  Fingerprint (SHA-256): ${caInfo.fingerprint}`);
    console.log(`  Key:  ${caInfo.keyPath}`);
    console.log(`  Cert: ${caInfo.certPath}`);
    console.log(`  Trusted: ${caInfo.isTrusted ? 'Yes' : 'No'}`);
    console.log('\nTo install to system CA store:');
    console.log('  npm run mitm-install-windows  (Windows)');
    console.log('  npm run mitm-export            (Export for manual install)\n');
  } catch (error) {
    console.error('✗ Error:', String(error));
    process.exit(1);
  }
}

main();
