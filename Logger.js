const { fmt } = require('./utils.js')
var fs = require('fs');
var util = require('util');

var CLEAN_LOGS = false;
const LOGS_FOLDER = "./logs/";

const cleanLogs = function(){
    CLEAN_LOGS = true;
}

class Logger {
    constructor(tag) {
        this.filename = tag.replaceAll(" ", "_");
        this.logFile = fs.createWriteStream(`${LOGS_FOLDER}/${this.filename}.txt`, { flags: `${CLEAN_LOGS ? 'w' : 'a'}` });
          // Or 'w' to truncate the file every time the process starts.
        this.logStdout = process.stdout;
        this.tag = tag;
        if(!CLEAN_LOGS)
            this.logFile.write("\n--------------------------------------------------------------------------\n\n");
    }

    log = function(){
        this.logFile.write(`[${this.tag} ${fmt(new Date())}] ${util.format.apply(null, arguments)}\n`);
        this.logStdout.write(`[${this.tag} ${fmt(new Date())}] ${util.format.apply(null, arguments)}\n`);
    }

    error = this.log;
}


module.exports = { Logger, cleanLogs };