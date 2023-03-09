#!/usr/bin/env node
const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
const config = require('./config.no-commit.json')
dotenv.config()

const { Utils, PropsHelper, NotionHelper } = require("./utils.js")
const { ScriptHelper } = require("./ScriptHelper.js")
const sleep = require("timers/promises").setTimeout;


// for(let key in config.availableScripts){
//   eval(`const ${config.AVAILABLE_SCRIPTS[key].className} = require('${config.AVAILABLE_SCRIPTS[key].path}')`)
// }
const notion = new Client({ auth: config.NOTION_KEY })



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
    this.updateScriptsDb()
      .then(() => {
        return this.updateScriptsOptions()
      }).then(() => {
        return this.startScripts()
      }).then(() =>{
        console.log("---- Init Completed ---- ")
      })
  }

  async startScripts(){
    console.log("\n**** Starting scripts! ****")
    for (const [key, scriptEntry] of Object.entries(this.scriptEntries)) {
      scriptEntry.startScript();
      await sleep(500); // This is needed to avoid Error 409 "Conflict while saving", it's caused by Notion internal working. See: https://www.reddit.com/r/Notion/comments/s8uast/error_deleting_all_the_blocks_in_a_page/
      // console.log("After Wait")
    }
  }

  async updateScriptsOptions() {
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

  isMasterDatabase(db) {
    return db.id.replaceAll("-", "") == this.masterDatabaseID;
  }

  async updateScriptsDb() {
    console.log("\n**** Updating scripts instances entries! ****")
    var dbEntries = await this.notion.getDBEntries(this.masterDatabaseID);
    for (let [index, entry] of dbEntries.entries()) {
      if(!this.scriptEntries.hasOwnProperty(entry.id)){
        var scriptName = entry.properties?.SCRIPT_ID?.select?.name;
        var scriptClassName = null;
        if(scriptName){
          for (let script of config.AVAILABLE_SCRIPTS) {
            if (script.name == scriptName) {
              scriptClassName = script.className;
              break;
            }
          }
        }
        this.scriptEntries[entry.id] = new ScriptHelper(this.notion, entry, index, scriptClassName, this.masterDatabaseID);
        if(!scriptClassName) console.error(`No script found with the name ${scriptName} for ${this.scriptEntries[entry.id].scriptId}`);
      } else{
        this.scriptEntries[entry.id].updateProps(entry);
      }
      await this.scriptEntries[entry.id].updateScriptEntry();
    }

    console.log("\n**** Updating attached DBs ****")
    try{
      var response =  await this.notion.getAttachedDBs();
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
}

const scriptsManager = new ScriptsManager(notion, config.AVAILABLE_SCRIPTS, config.NOTION_SCRIPTS_DATABASE_ID, 10000);
(async () => {
  await scriptsManager.update()
})()

