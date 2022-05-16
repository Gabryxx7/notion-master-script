var fs = require('fs');
// file is included here:
eval(fs.readFileSync('./index.js'));
getEntriesFromNotionDatabase().then((pages) => {
  console.log(pages);
})

