
const { Utils, MetadataHelper, PropsHelper, ParamsSchema, fmt } = require('./utils.js')
const { ScriptStatus, ScriptEnabledStatus } = require('./ScriptStatus.js')
const NotionLinkUpdater = require("./scripts/link_metadata")


class ScriptHelper {
    constructor(notion, entry, entryIndex, className) {
      this.notion = notion;
      this.errorsList = []
      this.entryIndex = entryIndex
      this.entry = entry;
      this.props = this.entry.properties;
      this.className = className;
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
        // error.m
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
        var ret = this.errorsList.length > 0 ? this.errorsList.map((x) => x.msg).join("\n> ") : "No Errors";
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
      console.log(`Creating script Instance ${this.className} for ${this.pageName} (${this.databaseId})`)
      try{
        console.log(`\n*** Instantiating ${this.className} ***`)
        var params = this.getParamsJson();
        var paramsOk = (eval(this.className)).paramsSchema.checkParams(params);
        this.scriptInstance = new (eval(this.className))(this, this.notion, params);
      } catch(error) {
        this.throwError(`Error instantiating ${this.className} on ${this.pageName}`, error);
      }
      return this.scriptInstance;
    }
  
    startScript() {
      if(this.scriptInstance == null){
        this.createScriptInstance()
        .then(async () => {
          if(this.scriptInstance == null){
            // this.throwError("Script not instantiated")
            return;
          }
          this.updateStatus(ScriptStatus.STARTED)
          this.scriptInstance.start()
        })
        return;
      }
  
      this.scriptInstance.start().then(async () => await this.updateStatus(ScriptStatus.STARTED));
    }
  
    async stopScript(stoppedStatus=ScriptStatus.STOPPED) {
      if(this.scriptInstance != null){
        this.scriptInstance.stop()
      }
      await this.updateStatus(stoppedStatus);
    }
  
    getProps() {
      return new PropsHelper()
      .addStatus("Status", this.scriptStatus.name)
      .addStatus("Enabled?", this.enabledStatus.name)
      .addRichText("Updates", `${fmt(new Date())} > ${this.flushErrors()}`)
      .build()
    }
  
    async updateStatus(newStatus){
      if(this.scriptStatus.id != newStatus.id){
        this.scriptStatus = newStatus;
        console.log(`Updating status: ${JSON.stringify(this.props["Page Name"]?.rich_text[0]?.text?.content)} -> ${this.scriptStatus.name}`)
      }
    }

    async updateEntryPage(){
        if(this.enabledStatus.id == ScriptEnabledStatus.DISABLED.id){
          await this.stopScript(ScriptStatus.DISABLED);
        }
        await this.notion.updatePage(this.entry.id, this.getProps())
        // console.log(`Updating Entry: ${JSON.stringify(this.props["Page Name"]?.rich_text[0]?.text)} (Status: ${this.scriptStatus.name})`)
    }
  
    async updateEntry(newEntry=null){
      if(newEntry != null){
        this.entry = newEntry;
        this.props = this.entry.props;
        this.enabledStatus = this.parseEnabledStatus(this.props["Enabled?"])
      }
    }
  }


module.exports = { ScriptHelper };
