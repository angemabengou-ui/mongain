const ApkParser = require('app-info-parser');
const path = require('path');

const apkPath = path.resolve(__dirname, '..', 'app.apk');
const parser = new ApkParser(apkPath);

parser.parse().then((result) => {
  const fs = require('fs');
  fs.writeFileSync(path.resolve(__dirname, 'manifest_full.json'), JSON.stringify(result, null, 2));
  console.log('Wrote full manifest JSON.');
  console.log('application meta-data:');
  const app = result?.manifest?.application;
  console.log(JSON.stringify(app?.['meta-data'], null, 2));
}).catch((err) => {
  console.error('ERROR', err);
  process.exit(1);
});
