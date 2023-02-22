#!/usr/bin/env node
const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
const config = require('./config.no-commit.json')
const { Utils, ScriptStatus, ScriptEnabledStatus, PropsHelper, NotionHelper } = require("./utils.js")

dotenv.config()
// for(let key in config.availableScripts){
//   eval(`const ${config.AVAILABLE_SCRIPTS[key].className} = require('${config.AVAILABLE_SCRIPTS[key].path}')`)
// }
const notion = new Client({ auth: config.NOTION_KEY })


class ScriptHelper {
  constructor(notion, entry) {
    this.notion = notion;
    this.latestErrors = []
    this.entryId = entry.id;
    this.props = entry.properties;
    this.enabledStatus = ScriptEnabledStatus.DISABLED;
    this.scriptStatus = ScriptStatus.NONE;
    try {
      var statusName = this.props["Enabled?"].status.name;
      this.enabledStatus = ScriptEnabledStatus[statusName.toUpperCase()]
    } catch (error) {
      console.error(error);
    }
    this.scriptInstance = null;
    this.pageId = null;
    this.pageName = "none";
    try {
      this.pageId = this.props["Page ID"].title[0].plain_text
      this.pageName = this.props["Page Name"].rich_text[0].plain_text
    } catch (error) {
      this.latestErrors.push("No page ID found, does this page exist? Did you add it yourself?")
    }
  }
  

  flushErrors() {
    var ret = this.latestErrors.join("\n")
    this.latestErrors = [];
    return ret;
  }

  createScriptInstance() {
    var scriptName = this.props.SCRIPT_ID.select.name;
    console.log(`Creating script Instance ${scriptName} for ${this.pageName} (${this.pageId})`)
    for (let script of config.AVAILABLE_SCRIPTS) {
      if (script.name == scriptName) {
        console.log(eval(script['class'][0]))
        this.scriptInstance = new (eval(script['class']))(this, this.notion, this.props.Parameters.rich_text[0].plain_text);
        return this.scriptInstance;
      }
    }
    console.error(`No script found with the name ${scriptName} for ${this.pageName} (${this.pageId})`)
  }

  startScript() {
    if(this.scriptInstance == null){
      this.createScriptInstance()
    }
    if(this.scriptInstance != null){
      this.scriptInstance.start()
    }
  }

  stopScript() {
    if(this.scriptInstance != null){
      this.scriptInstance.stop()
    }
  }

  getProps() {
    return new PropsHelper()
    .addStatus("Status", this.scriptStatus.name)
    .addStatus("Enabled?", this.enabledStatus.name)
    .addRichText("Errors", this.flushErrors())
    .build()
  }

  async updateEntry(){
    await this.notion.updatePage(this.entryId, this.getProps)
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
    console.log("**** Updating scripts options! ****")
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
        this.notion.createPage(NotionHelper.ParentType.DATABASE,
          this.masterDatabaseObj.id, props,
          (response) => this.notion.deletePage(response.id));
      }
    })
  }

  updateAttachedDatabases() {
    console.log("**** Updating attached DBs ****")
    return this.notion.searchDBs((results) => {
      results.map((attachedDb) => {
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
          if(value.pageId == attachedDb.id){
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
      })
    })    
  }

  isMasterDatabase(db) {
    return db.id.replaceAll("-", "") == this.masterDatabaseID;
  }

  async updateEntries() {
    console.log("**** Updating scripts instances entries! ****")
    var dbEntries = await this.notion.getDBEntries(this.masterDatabaseID);
    dbEntries.map(async (entry) => {
      if(this.scriptEntries.hasOwnProperty(entry.id)){
        await entry.updateEntry();
      } else{
        this.scriptEntries[entry.id] = new ScriptHelper(this.notion, entry);
      }
    })
  }
}

const scriptsManager = new ScriptsManager(notion, config.AVAILABLE_SCRIPTS, config.NOTION_SCRIPTS_DATABASE_ID, 10000);
(async () => {
  await scriptsManager.update()
})()

