#!/usr/bin/env node
const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
const config = require('./config.no-commit.json')
var { Logger, cleanLogs } = require("./Logger.js")
dotenv.config()

const { Utils, PropsHelper, NotionHelper } = require("./utils.js")
const { ScriptHelper } = require("./ScriptHelper.js")
const sleep = require("timers/promises").setTimeout;


// for(let key in config.availableScripts){
//   eval(`const ${config.AVAILABLE_SCRIPTS[key].className} = require('${config.AVAILABLE_SCRIPTS[key].path}')`)
// }
const notion = new Client({ auth: config.NOTION_KEY })

cleanLogs();

class ScriptsManager {
  constructor(notion, scriptsList, masterDatabaseID, columnsSchema, refreshTime) {
    this.notion = new NotionHelper(notion);
    this.logger = new Logger("ScriptsManager")
    this.masterDatabaseID = masterDatabaseID;
    this.masterDatabaseObj = null;
    this.refreshTime = refreshTime;
    this.columnsSchema = columnsSchema;
    this.availableScripts = scriptsList;
    for(let key in this.availableScripts){
      this.availableScripts[key]['class'] = require(this.availableScripts[key].path)
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
      scriptEntry.startScript();
      await sleep(500); // This is needed to avoid Error 409 "Conflict while saving", it's caused by Notion internal working. See: https://www.reddit.com/r/Notion/comments/s8uast/error_deleting_all_the_blocks_in_a_page/
      // this.logger.log("After Wait")
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
        this.notion.createPage(
          NotionHelper.ParentType.DATABASE,
          this.masterDatabaseObj.id,
          props)
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
        var scriptClassName = null;
        if(scriptName){
          for (let script of config.AVAILABLE_SCRIPTS) {
            if (script.name == scriptName) {
              scriptClassName = script.className;
              break;
            }
          }
        }
        this.scriptEntries[entry.id] = new ScriptHelper(this.notion, entry, index, scriptClassName, this.masterDatabaseID, this.columnsSchema);
        if(!scriptClassName){
          this.scriptEntries[entry.id].throwError(`No script found with the name ${scriptName} for ${this.scriptEntries[entry.id].scriptId}`)
        }
      } else{
        this.scriptEntries[entry.id].updateProps(entry);
      }
      await this.scriptEntries[entry.id].updateScriptEntry();
    }

    this.logger.log("**** Updating attached DBs metadata ****")
    try{
      var response =  await this.notion.getAttachedDBs();
      response.results.map((attachedDb) => {
        if(this.isMasterDatabase(attachedDb)){
          if(this.masterDatabaseObj == null){
            this.logger.log(`MasterDB Found! ${attachedDb.id}`)
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
        this.logger.log(`Adding new attached DB! ${attachedDb.id}`)
        var props = new PropsHelper()
          .addTitle(this.columnsSchema.pageId, attachedDb.id)
          .addRichText(this.columnsSchema.pageName, attachedDb.title[0].plain_text)
          .addTextLink(this.columnsSchema.pageLink, attachedDb.url, attachedDb.title[0].plain_text)
          .addSelect(this.columnsSchema.scriptId, "NONE")
          .build()
          
        this.notion.createPage(NotionHelper.ParentType.DATABASE, this.masterDatabaseID, props)
          .then((response) => this.logger.log(`New page created {response.id}`))
          .catch((error) => this.logger.error("Error creating page for new Attached DB", error))
      })  
    }catch(error){
      this.logger.error("Error retreiving attached DBs", error)
    }
  }
}

const scriptsManager = new ScriptsManager(notion, config.AVAILABLE_SCRIPTS, config.NOTION_SCRIPTS_DATABASE_ID, config.COLUMNS_SCHEMA, config.SCRIPT_DB_REFRESH_TIME);
(async () => {
  await scriptsManager.update(true);
})()

