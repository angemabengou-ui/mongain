const fs = require('fs');
const files = [
  'src/AgencyCenter.tsx', 'src/Customer360.tsx', 'src/StaffAccessRights.tsx', 
  'src/StaffAssignBranch.tsx', 'src/SystemAccounts.tsx', 'src/components/GlobalSearch.tsx'
];
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace(/width:\s*'auto',\s*flex:\s*'1 1 200px',\s*width:\s*'100%',/g, "flex: '1 1 200px', width: '100%',");
  content = content.replace(/width:\s*'auto',\s*flex:\s*'1 1 200px',\s*width:\s*'auto',/g, "flex: '1 1 200px', width: 'auto',");
  content = content.replace(/width:\s*'auto',\s*flex:\s*'1 1 200px',\s*background/g, "width: 'auto', flex: '1 1 200px', background");
  // Some specifically have width: 'auto', width: '100%'
  content = content.replace(/width:\s*'auto',\s*width:\s*'100%',/g, "width: '100%',");
  // Let's just blindly remove width: 'auto', flex: '1 1 200px', IF it is followed by width: '100%' anywhere on the same line
  let lines = content.split('\n');
  lines = lines.map(line => {
      if(line.includes("width: 'auto'") && line.match(/width:/g)?.length > 1) {
          return line.replace(/width:\s*'auto',\s*/, '');
      }
      return line;
  });
  fs.writeFileSync(f, lines.join('\n'));
});
console.log('Fixed duplicates');
