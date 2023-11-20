#!/usr/bin/env node
const dotenv = require("dotenv")
dotenv.config()
const config = require('./config.no-commit.json')
const sleep = require("timers/promises").setTimeout;

const { NotionHelper } = require("./Helpers/NotionHelper.js")
const { PropsHelper } = require("./Helpers/PropsHelper.js")
const { ScriptHelper } = require("./Helpers/ScriptHelper.js")
var { Logger, cleanLogs } = require("./Helpers/Logger.js")


cleanLogs();

class ScriptsManager {
  constructor(scriptsList, masterDatabaseID, columnsSchema, refreshTime) {
    this.notion = new NotionHelper(config.NOTION_KEY);
    this.logger = new Logger("ScriptsManager")
    this.masterDatabaseID = masterDatabaseID;
    this.masterDatabaseObj = null;
    this.refreshTime = refreshTime;
    this.columnsSchema = columnsSchema;
    this.availableScripts = scriptsList;
    for(let key in this.availableScripts){
      this.availableScripts[key]['class'] = (eval(`require('${this.availableScripts[key].path}').${this.availableScripts[key].className}`))
    }
    this.scriptEntries = {}
    this.attachedDatabases = []
  }

  async update(firstInit=false) {
    this.updateScriptsDb()
      .then(() => {
        return this.updateScriptsOptions()
      }).then(() => {
        return this.startScripts()
      }).then(() =>{
        if(firstInit)
          this.logger.log("---- Init Completed ---- ")
        else
          this.logger.log("---- Master DB Script Manager update ---- ")
          setTimeout(async () => {await this.update()}, this.refreshTime)
      })
  }
  

  async startScripts(){
    this.logger.log("**** Starting scripts! ****")
    for (const [key, scriptEntry] of Object.entries(this.scriptEntries)) {
      if(!scriptEntry.enabledStatus) return;
      await scriptEntry.startScript();
      await sleep(500); // This is needed to avoid Error 409 "Conflict while saving", it's caused by Notion internal working. See: https://www.reddit.com/r/Notion/comments/s8uast/error_deleting_all_the_blocks_in_a_page/
      this.logger.log("After Wait")
    }
  }

  async updateScriptsOptions() {
    this.logger.log("**** Updating scripts options! ****")
    if(!this.masterDatabaseObj){
      this.logger.error("No master database set! Did you add it to the config.json file? Did you connect the integration with it?")
      return;
    }
    var dbOptions = this.masterDatabaseObj.properties[this.columnsSchema.scriptId].select.options;
    this.availableScripts.map((availableScript) => {
      var isOptionInDb = dbOptions.find((opt) => opt.name == availableScript.name)
      if(isOptionInDb === undefined){
        this.logger.log(`Option ${availableScript.name} not in DB options, adding it now!`)
        // Add the new option through a new empty entry, and delete it immediately on response
        var props = new PropsHelper().addSelect("SCRIPT_ID", availableScript.name).build();
        this.notion.createPageInDb( this.masterDatabaseObj.id, props)
          .then((response) => this.notion.deletePage(response.id))
          .catch((error) => this.logger.error("Error creating empty page for script options", error))
      }
    })
  }

  isMasterDatabase(db) {
    return db.id.replaceAll("-", "") == this.masterDatabaseID;
  }

  async updateScriptsDb() {
    this.logger.log("**** Updating scripts instances entries! ****")
    var dbEntries = await this.notion.getDBEntries(this.masterDatabaseID);
    for (let [index, entry] of dbEntries.entries()) {
      if(!this.scriptEntries.hasOwnProperty(entry.id)){
        var scriptName = entry.properties[this.columnsSchema.scriptId]?.select?.name;
        var scriptData = null;
        if(scriptName){
          for (let script of this.availableScripts) {
            // var script = this.availableScripts[key];
            if (script.name == scriptName) {
              scriptData = script;
              break;
            }
          }
        }
        if(!scriptData){
          this.scriptEntries[entry.id].throwError(`No script found with the name ${scriptName} for ${this.scriptEntries[entry.id].scriptId}`);
          continue;
        }
        const newScriptEntry = new ScriptHelper(this.notion, entry, scriptData, this.masterDatabaseID, this.columnsSchema);
        if(!newScriptEntry.enabledStatus) continue;
        this.scriptEntries[entry.id] = newScriptEntry;
      } else{
        this.scriptEntries[entry.id].updateProps(entry);
      }
      await this.scriptEntries[entry.id].updateScriptEntry();
    }

    this.logger.log("**** Updating attached DBs metadata ****")
    try{
      var response =  await this.notion.getAttachedDBs();
      response.results.forEach((attachedDb) => {
        if(this.isMasterDatabase(attachedDb)){
          if(this.masterDatabaseObj == null){
            this.logger.log(`MasterDB Found! ${attachedDb.id}`)
          }
          this.masterDatabaseObj = attachedDb;
          return;
        }


        if(!config.UPDATE_MASTER_VIEW) return;
        // Checking whether the attached database is already listed in one of the entries
        // Can be confusing: Iterating the row of the master database and looking for the attached DB's Page ID
        for (const [key, value] of Object.entries(this.scriptEntries)) {
          if(value.databaseId == attachedDb.id){
            return;
          }
        }
        this.logger.log(`Adding new attached DB! ${attachedDb.id}`)
        var dbTitle = attachedDb.title[0].plain_text;
        var props = new PropsHelper()
          .addTitle(this.columnsSchema.pageId, attachedDb.id)
          .addRichText(this.columnsSchema.pageName, dbTitle)
          .addLink(this.columnsSchema.pageLink, attachedDb.url, true, dbTitle)
          .addSelect(this.columnsSchema.scriptId, "NONE")
          .build()
          
        this.notion.createPageInDb(this.masterDatabaseID, props)
          .then((response) => this.logger.log(`New page created ${response.id}`))
          .catch((error) => this.logger.error(`Error creating page for new Attached DB ${attachedDb.id}`, error))
      })  
    }catch(error){
      this.logger.error("Error retreiving attached DBs", error)
    }
  }
}

const scriptsManager = new ScriptsManager(config.AVAILABLE_SCRIPTS, config.NOTION_SCRIPTS_DATABASE_ID, config.COLUMNS_SCHEMA, config.SCRIPT_DB_REFRESH_TIME);
(async () => {
  await scriptsManager.update(true);
})()

