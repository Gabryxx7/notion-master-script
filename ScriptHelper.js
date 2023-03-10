
const { Utils, MetadataHelper, PropsHelper, ParamsSchema, fmt } = require('./utils.js')
const { ScriptStatus } = require('./ScriptStatus.js')
const NotionLinkUpdater = require("./scripts/link_metadata")
const { Logger } = require("./Logger.js")


class ScriptHelper {
    constructor(notion, entry, entryIndex, className, masterDatabaseID, columnsSchema) {
      this.notion = notion;
      this.masterDatabaseID = masterDatabaseID;
      this.errorsList = []
      this.entryIndex = entryIndex
      this.entry = entry;
      this.columnsSchema = columnsSchema;
      this.props = entry.properties;
      this.scriptName = this.props[this.columnsSchema.scriptId]?.select?.name;
      this.className = className;
      this.scriptStatus = ScriptStatus.NONE;
      this.enabledStatus = this.props[this.columnsSchema.enabledStatus].checkbox;
      this.scriptInstance = null;
      this.databaseId = null;
      this.pageName = "none";
      this.refreshTime = 3000;
      this.scriptId = `Entry Index ${this.entryIndex}`
      try {
        this.databaseId = this.props[this.columnsSchema.pageId].title[0].plain_text;
        this.pageName = this.props[this.columnsSchema.pageName].rich_text[0].plain_text;
        this.scriptId = `${this.pageName} (${this.scriptName})`
      } catch (error) {
        this.throwError(`No page/database ID found, does this page/db exist? Was it added manually?`)
      }
      this.logger = new Logger(this.scriptId)
      this.scriptLoopHandle = null;
    }  
  
    throwError(msg, errorObj=null){
      this.updateStatus(ScriptStatus.ERROR)
      if(errorObj != null){
        msg =`${msg}: ${errorObj.message}`
      }
      this.errorsList.push({msg: msg, errorObj: errorObj});
      if(this.logger){
        this.logger.error(msg)
      }
    }
    
  
    flushErrors() {
        var ret = this.errorsList.length > 0 ? this.errorsList.map((x) => x.msg).join("\n> ") : "";
        // this.logger.log(`**** [${this.pageName}] FLUSHING ERRORS ****\n${ret}\n`)
        this.errorsList = [];
        return ret;
    }
  
    getParamsJson(){
      var jsonParams = {}
      try{
        var paramsStr = `${this.props[this.columnsSchema.scriptParams].rich_text[0].plain_text.toString('utf8')}`;
        // this.logger.log("", paramsStr, "\n")
        paramsStr = paramsStr.replaceAll(/“|”/g, '"');
        // this.logger.log("", paramsStr, "\n")
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
        this.logger.log(`*** Instantiating ${this.className} for [${this.scriptId}] ***`)
        var params = this.getParamsJson();
        this.logger.log(`Params Before ${JSON.stringify(params)}`);
        params = (eval(this.className)).paramsSchema.checkParams(params);
        this.logger.log(`Params After ${JSON.stringify(params)}`);
        this.refreshTime = params['refreshTime'] ? params['refreshTime'] : this.refreshTime;
        this.scriptInstance = new (eval(this.className))(this, this.notion, params);
      } catch(error) {
        this.throwError(`Error instantiating ${this.className} for [${this.scriptId}] `, error);
      }
      return this.scriptInstance;
    }

    shouldStop(){
      return ([ScriptStatus.STOPPED.id, ScriptStatus.DISABLED.id, ScriptStatus.ERROR.id].includes(this.scriptStatus.id) || !this.enabledStatus)
    }

    startScript() {
      if(this.scriptInstance == null){
        this.createScriptInstance()
      }
      if(this.shouldStop()){
        return;
      }
      if([ScriptStatus.RUNNING.id, ScriptStatus.STARTED.id].includes(this.scriptStatus.id)){
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
        this.logger.log(`Stopping: ${this.scriptStatus.name}`);
        (async () => {this.updateScriptEntry()})();
        return;
      }
      this.updateStatus(ScriptStatus.RUNNING);
      // this.logger.log(`Update`)
      this.scriptInstance.update();
      this.notion.getUpdatedDBEntry(this.masterDatabaseID, this.columnsSchema.pageId, this.databaseId)
        .then((res) => {
          // this.logger.log(`Updated db entry : ${res.results.length}`)
          // this.logger.log(res.results[0])
          this.updateProps(res.results[0]);
          this.updateScriptEntry()
            .then(() => setTimeout(() => this.update(), this.refreshTime))
            .catch((error) => this.throwError(error))
        })
        .catch((error) => this.throwError(error))
    }
  
    getProps() {
      return new PropsHelper()
      .addStatus(this.columnsSchema.runningStatus, this.scriptStatus.name)
      .addCheckbox(this.columnsSchema.enabledStatus, this.enabledStatus)
      .addRichText(this.columnsSchema.errors, `> ${this.flushErrors()}`)
      .build()
    }
  
    updateStatus(newStatus){
      if(this.scriptStatus.id != newStatus.id){
        this.logger.log(`Updating status: ${this.scriptStatus.name} -> ${newStatus.name}`)
        this.scriptStatus = newStatus;
      }
    }

    async updateScriptEntry(){
      if(!this.enabledStatus){
        this.updateStatus(ScriptStatus.DISABLED);
      }
      if(this.shouldStop()){
        this.stopScript();
      }
      try{
        await this.notion.updatePage(this.entry.id, this.getProps())
      }
      catch(error){
        this.logger.log(`Error updating page ${this.entry.id}: ${error.message}`);
      }
      // this.logger.log(`Updating Entry: ${JSON.stringify(this.props["Page Name"]?.rich_text[0]?.text)} (Status: ${this.scriptStatus.name})`)
    }
  
    updateProps(newEntry=null){
      if(newEntry != null){
        this.entry = newEntry;
        this.props = newEntry.properties;
        this.enabledStatus = this.props[this.columnsSchema.enabledStatus].checkbox;
      }
    }
  }


module.exports = { ScriptHelper };
