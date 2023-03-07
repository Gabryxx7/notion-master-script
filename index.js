#!/usr/bin/env node
const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
const config = require('./config.no-commit.json')
const NotionLinkUpdater = require("./scripts/link_metadata")
const { Utils, ScriptStatus, ScriptEnabledStatus, PropsHelper, NotionHelper } = require("./utils.js")

dotenv.config()
// for(let key in config.availableScripts){
//   eval(`const ${config.AVAILABLE_SCRIPTS[key].className} = require('${config.AVAILABLE_SCRIPTS[key].path}')`)
// }
const notion = new Client({ auth: config.NOTION_KEY })


class ScriptHelper {
  constructor(notion, entry, entryIndex) {
    this.notion = notion;
    this.errorsList = []
    this.entryIndex = entryIndex
    this.entry = entry;
    this.props = this.entry.properties;
    this.scriptStatus = ScriptStatus.NONE;
    this.enabledStatus = this.parseEnabledStatus(this.props["Enabled?"])
    this.scriptInstance = null;
    this.databaseId = null;
    this.pageName = "none";
    try {
      this.databaseId = this.props["Page ID"].title[0].plain_text;
      this.pageName = this.props["Page Name"].rich_text[0].plain_text;
    } catch (error) {
      this.throwError(`Entry ${this.entryIndex} No page/database ID found, does this page/db exist? Was it added manually?`)
    }
  }

  parseEnabledStatus(statusProp){
    try {
      var statusName = statusProp.status.name;
      return ScriptEnabledStatus[statusName.toUpperCase()]
    } catch (error) {
      error.m
      this.throwError("Error checking Enabled status, script automatically Disabled", error)
    }
    return ScriptEnabledStatus.DISABLED;
  }


  throwError(msg, errorObj=null){
    if(errorObj != null){
      msg =`${msg}: ${errorObj.message}`
    }
    this.errorsList.push({msg: msg, errorObj: errorObj});
    console.error(msg)
    // console.error(msg, errorObj)
    console.log()
  }
  

  flushErrors() {
    var ret = this.errorsList.map((x) => x.msg).join("\n> ")
    ret = `> ${ret}`;
    // console.log(`\n**** [${this.pageName}] FLUSHING ERRORS ****\n${ret}\n`)
    this.errorsList = [];
    return ret;
  }

  getParamsJson(){
    var jsonParams = {}
    try{
      var paramsStr = `${this.props.Parameters.rich_text[0].plain_text.toString('utf8')}`;
      // console.log("\n", paramsStr, "\n")
      paramsStr = paramsStr.replaceAll(/“|”/g, '"');
      // console.log("\n", paramsStr, "\n")
      try{
        jsonParams = JSON.parse(paramsStr, 'utf8');
        console.log(jsonParams)
      } catch(error){
        this.throwError("Error parsing script parameters", error)
      }
    } catch(error){
      // this.throwError("No parameters passed", error)
    }
    if(!jsonParams.hasOwnProperty("databaseId") && this.databaseId != null){
      jsonParams['databaseId'] = this.databaseId.replaceAll("-", "");
    }
    return jsonParams;
  }

  async createScriptInstance() {
    var scriptName = this.props.SCRIPT_ID.select.name;
    console.log(`Creating script Instance ${scriptName} for ${this.pageName} (${this.databaseId})`)
    for (let script of config.AVAILABLE_SCRIPTS) {
      if (script.name == scriptName) {
        var className = script.className;
        try{
          console.log(`** Instantiating ${className} **`)
          var params = this.getParamsJson();
          var paramsOk = (eval(className)).paramsSchema.checkParams(params);
          this.scriptInstance = new (eval(className))(this, this.notion, params);
        } catch(error) {
          this.throwError(`Error instantiating ${className} on ${this.pageName}`, error);
        }
        return this.scriptInstance;
      }
    }
    this.throwError(`No script found with the name ${scriptName} for ${this.pageName} (${this.databaseId})`);
  }

  startScript() {
    if(this.scriptInstance == null){
      this.createScriptInstance()
      .then(async () => await this.updateStatus(ScriptStatus.NOT_STARTED))
      .then(async () => {
        if(this.scriptInstance == null){
          // this.throwError("Script not instantiated")
          return;
        }
        this.scriptInstance.start()
      })
      .then(async () => await this.updateStatus(ScriptStatus.STARTED))
      return;
    }
    this.scriptInstance.start()
    .then(async () => await this.updateStatus(ScriptStatus.STARTED));
  }

  async stopScript() {
    if(this.scriptInstance != null){
      this.scriptInstance.stop()
      await this.updateStatus(ScriptStatus.STOPPED);
    }
  }

  getProps() {
    return new PropsHelper()
    .addStatus("Status", this.scriptStatus.name)
    .addStatus("Enabled?", this.enabledStatus.name)
    .addRichText("Errors", this.flushErrors())
    .build()
  }

  async updateStatus(newStatus){
    this.scriptStatus = newStatus;
    await this.updateEntry();
  }

  async updateEntry(newEntry=null){
    if(newEntry != null){
      this.entry = newEntry;
      this.props = this.entry.props;
      this.enabledStatus = this.parseEnabledStatus(this.props["Enabled?"])
    }
    if(this.enabledStatus.id == ScriptEnabledStatus.DISABLED.id){
      await this.stopScript();
    }
    await this.notion.updatePage(this.entry.id, this.getProps())
  }
}

class ScriptsManager {
  constructor(notion, scriptsList, masterDatabaseID, refreshTime) {
    this.notion = new NotionHelper(notion);
    this.masterDatabaseID = masterDatabaseID;
    this.masterDatabaseObj = null;
    this.refreshTime = refreshTime;
    this.availableScripts = scriptsList;
    for(let key in this.availableScripts){
      this.availableScripts[key]['class'] = require(this.availableScripts[key].path)
    }
    this.scriptEntries = {}
    this.attachedDatabases = []
  }

  async update() {
    this.updateEntries()
      .then(() => {
        return this.updateAttachedDatabases()
      }).then(() => {
        return this.updateScriptOptions()
      }).then(() => {
        return this.updateScriptsStatus()
      }).then(() =>{
        console.log("Completed! Updating running scripts")
      })
  }

  async updateScriptsStatus(){
    for (const [key, value] of Object.entries(this.scriptEntries)) {
      value.startScript();
    }
  }

  async updateScriptOptions() {
    console.log("\n**** Updating scripts options! ****")
    if(!this.masterDatabaseObj){
      console.error("No master database set! Did you add it to the config.json file? Did you connect the integration with it?")
      return;
    }
    var dbOptions = this.masterDatabaseObj.properties.SCRIPT_ID.select.options;
    this.availableScripts.map((availableScript) => {
      var isOptionInDb = dbOptions.find((opt) => opt.name == availableScript.name)
      if(isOptionInDb === undefined){
        console.log(`Option ${availableScript.name} not in DB options, adding it now!`)
        // Add the new option through a new empty entry, and delete it immediately on response
        var props = new PropsHelper().addSelect("SCRIPT_ID", availableScript.name).build();
        this.notion.createPage(
          NotionHelper.ParentType.DATABASE,
          this.masterDatabaseObj.id,
          props)
        .then((response) => this.notion.deletePage(response.id))
        .catch((error) => console.error("Error creating empty page for script options", error))
      }
    })
  }

  async updateAttachedDatabases() {
    console.log("\n**** Updating attached DBs ****")
    try{
      var response =  await this.notion.searchDBs();
      response.results.map((attachedDb) => {
        if(this.isMasterDatabase(attachedDb)){
          if(this.masterDatabaseObj == null){
            console.log(`MasterDB Found! ${attachedDb.id}`)
          }
          this.masterDatabaseObj = attachedDb;
          return;
        }
        // Checking whether the attached database is already listed in one of the entries
        // Can be confusing: Iterating the row of the master database and looking for the attached DB's Page ID
        for (const [key, value] of Object.entries(this.scriptEntries)) {
          if(value.databaseId == attachedDb.id){
            return;
          }
        }
        console.log(`Adding new attached DB! ${attachedDb.id}`)
        var props = new PropsHelper()
          .addTitle("Page ID", attachedDb.id)
          .addRichText("Page Name", attachedDb.title[0].plain_text)
          .addRichText("Page Link", attachedDb.url)
          .addSelect("SCRIPT_ID", "NONE")
          .build()
        this.notion.createPage(NotionHelper.ParentType.DATABASE, this.masterDatabaseObj.id, props)
          .then((response) => this.notion.deletePage(response.id))
          .catch((error) => console.error("Error creating page for new Attached DB", error))
      })  
    }catch(error){
      console.error("Error retreiving attached DBs", error)
    }
  }

  isMasterDatabase(db) {
    return db.id.replaceAll("-", "") == this.masterDatabaseID;
  }

  async updateEntries() {
    console.log("\n**** Updating scripts instances entries! ****")
    var dbEntries = await this.notion.getDBEntries(this.masterDatabaseID);
    dbEntries.map(async (entry, index) => {
      if(this.scriptEntries.hasOwnProperty(entry.id)){
        await entry.updateEntry(entry);
      } else{
        this.scriptEntries[entry.id] = new ScriptHelper(this.notion, entry, index);
      }
    })
  }
}

const scriptsManager = new ScriptsManager(notion, config.AVAILABLE_SCRIPTS, config.NOTION_SCRIPTS_DATABASE_ID, 10000);
(async () => {
  await scriptsManager.update()
})()

