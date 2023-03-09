
const { Utils, MetadataHelper, PropsHelper, ParamsSchema, fmt } = require('./utils.js')
const { ScriptStatus, ScriptEnabledStatus } = require('./ScriptStatus.js')
const NotionLinkUpdater = require("./scripts/link_metadata")


class ScriptHelper {
    constructor(notion, entry, entryIndex, className, masterDatabaseID) {
      this.notion = notion;
      this.masterDatabaseID = masterDatabaseID;
      this.errorsList = []
      this.entryIndex = entryIndex
      this.entry = entry;
      this.props = entry.properties;
      this.scriptName = this.props?.SCRIPT_ID?.select?.name;
      this.className = className;
      this.scriptStatus = ScriptStatus.NONE;
      this.enabledStatus = this.parseEnabledStatus(this.props["Enabled?"])
      this.scriptInstance = null;
      this.databaseId = null;
      this.pageName = "none";
      this.refreshTime = 3000;
      this.scriptId = `Entry Index ${this.entryIndex}`
      try {
        this.databaseId = this.props["Page ID"].title[0].plain_text;
        this.pageName = this.props["Page Name"].rich_text[0].plain_text;
        this.scriptId = `${this.pageName} (${this.scriptName})`
      } catch (error) {
        this.throwError(`No page/database ID found, does this page/db exist? Was it added manually?`)
      }
      this.scriptLoopHandle = null;
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
      console.error(`[${this.scriptId}] msg`)
      // console.error(msg, errorObj)
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
  
    createScriptInstance() {
      try{
        console.log(`\n*** Instantiating ${this.className} for [${this.scriptId}] ***`)
        var params = this.getParamsJson();
        var paramsOk = (eval(this.className)).paramsSchema.checkParams(params);
        this.refreshTime = params['refreshTime'] ? params['refreshTime'] : this.refreshTime;
        this.scriptInstance = new (eval(this.className))(this, this.notion, params);
      } catch(error) {
        this.throwError(`Error instantiating ${this.className} for [${this.scriptId}] `, error);
      }
      return this.scriptInstance;
    }

    shouldStop(){
      return ([ScriptStatus.STOPPED.id, ScriptStatus.DISABLED.id].includes(this.scriptStatus.id) || this.enabledStatus.id == ScriptEnabledStatus.DISABLED.id)
    }

    startScript() {
      if(this.scriptInstance == null){
        this.createScriptInstance()
      }
      if(this.shouldStop()){
        return;
      }
      this.updateStatus(ScriptStatus.STARTED);
      this.update();
    }
  
    stopScript() {
      if (this.scriptLoopHandle != null){
          clearTimeout(this.scriptLoopHandle)
      }
    }

    update(){
      if(this.shouldStop()){
        console.log(`[${this.scriptId}] Stopping: ${this.scriptStatus.name}`);
        (async () => {this.updateScriptEntry()})();
        return;
      }
      this.updateStatus(ScriptStatus.RUNNING);
      console.log(`[${this.scriptId}] ${fmt(new Date())} Update`)
      this.scriptInstance.update();
      this.notion.getUpdatedDBEntry(this.masterDatabaseID, 'Page ID', this.databaseId)
        .then((res) => {
          console.log(`[${this.scriptId}] Updating entry`)
          // console.log(`[${this.scriptId}] Updated db entry : ${res.results.length}`)
          // console.log(res.results[0])
          this.updateProps(res.results[0]);
          this.updateScriptEntry()
            .then(() => setTimeout(() => this.update(), this.refreshTime))
            .catch((error) => this.throwError(error))
        })
        .catch((error) => this.throwError(error))
    }
  
    getProps() {
      return new PropsHelper()
      .addStatus("Status", this.scriptStatus.name)
      .addStatus("Enabled?", this.enabledStatus.name)
      .addRichText("Updates", `${fmt(new Date())} > ${this.flushErrors()}`)
      .build()
    }
  
    updateStatus(newStatus){
      if(this.scriptStatus.id != newStatus.id){
        console.log(`[${this.scriptId}] Updating status: ${this.scriptStatus.name} -> ${newStatus.name}`)
        this.scriptStatus = newStatus;
      }
    }

    async updateScriptEntry(){
      // console.log(`[${this.scriptId}] ${this.enabledStatus.name}`)
        if(this.enabledStatus.id == ScriptEnabledStatus.DISABLED.id){
          this.updateStatus(ScriptStatus.DISABLED);
          this.stopScript();
        }
        await this.notion.updatePage(this.entry.id, this.getProps())
        // console.log(`Updating Entry: ${JSON.stringify(this.props["Page Name"]?.rich_text[0]?.text)} (Status: ${this.scriptStatus.name})`)
    }
  
    updateProps(newEntry=null){
      if(newEntry != null){
        this.entry = newEntry;
        this.props = newEntry.properties;
        this.enabledStatus = this.parseEnabledStatus(this.props["Enabled?"])
      }
    }
  }


module.exports = { ScriptHelper };
