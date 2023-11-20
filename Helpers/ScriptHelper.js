
const { PropsHelper } = require('./PropsHelper')
// const NotionLinkUpdater = require("../scripts/link_metadata")
const { Logger } = require("./Logger.js")
const fsPromises = require('fs').promises;

const ScriptStatus = {
  NONE: { "name": "None", "id": -1 },
  SCRIPT_NOT_FOUND: { "name": "Script Not Found", "id": 0 },
  STARTED: { "name": "Started", "id": 1 },
  STOPPED: { "name": "Stopped", "id": 2 },
  DISABLED: { "name": "Disabled", "id": 3 },
  RUNNING: { "name": "Running", "id": 4 },
  ERROR: { "name": "Error", "id": 5 }
}

class ScriptHelper {
  constructor(notion, entry, scriptData, masterDatabaseID, columnsSchema, parsedProps=null) {
    this.notion = notion;
    this.masterDatabaseID = masterDatabaseID;
    this.errorsList = []
    this.entry = entry;
    this.scriptId = `Entry ${entry.id} `
    this.logger = new Logger(this.scriptId)
    this.columnsSchema = columnsSchema;
    this.props = parsedProps ?? new PropsHelper(entry.properties);
    this.scriptName = this.props.getSelect(this.columnsSchema.scriptId);
    this.scriptData = scriptData;
    this.scriptStatus = ScriptStatus.NONE;
    this.enabledStatus = this.props.getCheckbox(this.columnsSchema.enabledStatus);
    this.scriptInstance = null;
    this.databaseId = null;
    this.pageName = "none";
    this.refreshTime = 3000;
    if(this.enabledStatus){
      try {
        this.databaseId = this.props.getTitle(this.columnsSchema.pageId);
        this.pageName = this.props.getText(this.columnsSchema.pageName)
        this.scriptId = `${this.pageName} (${this.scriptName})`
      } catch (error) {
        this.throwError(`No page/database ID found, does this page/db exist? Was it added manually?`)
      }
    }
    this.scriptLoopHandle = null;
  }

  throwError(msg, errorObj = null) {
    this.updateStatus(ScriptStatus.ERROR)
    if (errorObj != null) {
      msg = `${msg}: ${errorObj.message}`
    }
    this.errorsList.push({ msg: msg, errorObj: errorObj });
    if (this.logger) {
      this.logger.error(msg)
    }
  }

  flushErrors() {
    var ret = this.errorsList.length > 0 ? this.errorsList.map((x) => x.msg).join("\n> ") : "";
    this.logger.log(`**** [${this.pageName}] FLUSHING ERRORS ****${ret}`)
    this.errorsList = [];
    return ret;
  }

  getParamsCodeBlock(blocks, caption="params") {
    if (blocks.length <= 0)
      return null;
    for(var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.code) {
        if(block.code.caption.length > 0){
          if(block.code.caption[0].text.content.includes(caption)){
            return block;
          }
        }
      }
    }
    return null;
  }

  async getParamsJson() {
    var codeBlock = null;
    let jsonParams = {};
    jsonParams['databaseId'] = this.databaseId.replaceAll("-", "");
    try {
      const paramsCaption = `params_${this.scriptData.name}`;
      var blocks = await this.notion.retrievePageBlocks(this.entry.id);
      blocks = blocks.results;
      // fsPromises.writeFile(`./logs/${this.pageName}_Blocks.json`, JSON.stringify(blocks))
      codeBlock = this.getParamsCodeBlock(blocks, paramsCaption);
      // fsPromises.writeFile(`./logs/${this.pageName}_ParamsBlock.json`, JSON.stringify(codeBlock))
      if(!codeBlock){
        var defBlockList = require("./defaultScriptPage.json");
        defBlockList[1].code.text[0].text.content = this.scriptData.class.paramsSchema.toString();
        defBlockList[1].code.caption[0].text.content = paramsCaption;
        var addedBlocks = await this.notion.appendBlocks(this.entry.id, defBlockList);
        addedBlocks = addedBlocks.results[0];
        // fsPromises.writeFile(`./logs/${this.pageName}_AddedBlocks.json`, JSON.stringify(addedBlocks))
        codeBlock = this.getParamsCodeBlock(addedBlocks, paramsCaption);
        // fsPromises.writeFile(`./logs/${this.pageName}_ParamsAddedBlock.json`, JSON.stringify(codeBlock))
      }
      var paramBlockLink = `https://www.notion.so/gabryxx7/${this.databaseId}-${codeBlock.parent.page_id.replaceAll("-", "")}#${codeBlock.id.replaceAll("-", "")}`;
      var newProp = new PropsHelper().addLink(this.columnsSchema.scriptParams, paramBlockLink, true, "Parameters")
      await this.notion.updatePage(this.entry.id, newProp.build());
      jsonParams = {...jsonParams, ...JSON.parse(codeBlock.code.text[0].plain_text)};
      // fsPromises.writeFile(`./logs/${this.pageName}_Params_PRE.json`, JSON.stringify(jsonParams))
      // fsPromises.writeFile(`./logs/${this.pageName}_Params_POST.json`, JSON.stringify(jsonParams))
    } catch (error) {
      this.throwError("Error getting parameters data from script entry: No parameters found!", error)
    }
    return jsonParams;
  }

  async createScriptInstance() {
    this.logger.log(`*** Instantiating ${this.scriptData.className} for [${this.scriptId}] ***`)
    let params = {};
    try {
      params = await this.getParamsJson();
      params = this.scriptData.class.paramsSchema.checkParams(params);
    } catch (error) {
      this.throwError(`Error getting parameters for script: ${this.scriptData.className}, id: [${this.scriptId}] `, error);
    }

    try {
      this.refreshTime = params['refreshTime'] ?? this.refreshTime;
      this.scriptInstance = new this.scriptData.class(this, this.notion, params);
    } catch (error) {
      this.throwError(`Error instantiating ${this.scriptData.className} for [${this.scriptId}] `, error);
    }
    return this.scriptInstance;
  }

  shouldStop() {
    return (!this.enabledStatus || [ScriptStatus.STOPPED.id, ScriptStatus.DISABLED.id, ScriptStatus.ERROR.id].includes(this.scriptStatus.id))
  }

  async startScript() {
    if (this.shouldStop()) {
      return;
    }
    if (this.scriptInstance == null) {
      await this.createScriptInstance()
    }
    if ([ScriptStatus.RUNNING.id, ScriptStatus.STARTED.id].includes(this.scriptStatus.id)) {
      return;
    }
    this.updateStatus(ScriptStatus.STARTED);
    this.update();
  }

  stopScript() {
    if (this.scriptLoopHandle != null) {
      clearTimeout(this.scriptLoopHandle)
    }
  }

  update() {
    if (this.shouldStop()) {
      this.logger.log(`Stopping: ${this.scriptStatus.name}`);
      (async () => { this.updateScriptEntry() })();
      return;
    }
    this.updateStatus(ScriptStatus.RUNNING);
    if(this.scriptInstance != null){
      this.scriptInstance.update();
    }
    this.logger.log(`Updating master DB script entry`)
    this.notion.getUpdatedDBEntry(this.masterDatabaseID, this.columnsSchema.pageId, this.databaseId)
      .then(async (res) => {
        this.logger.log(`Updated db entry : ${res.results.length}`)
        // this.logger.log(res.results[0])
        await this.updateProps(res.results[0]);
      })
      .catch((error) => this.throwError(`Error updating DB entry for ${this.databaseId}`, error))
      .finally(() =>  this.updateScriptEntry()
        .then(() => setTimeout(() => this.update(), this.refreshTime))
        .catch((error) => this.throwError(`Error updating script entrt for ${this.databaseId}`, error)))
  }

  getProps() {
    return new PropsHelper()
      .addStatus(this.columnsSchema.runningStatus, this.scriptStatus.name)
      .addCheckbox(this.columnsSchema.enabledStatus, this.enabledStatus)
      .addRichText(this.columnsSchema.errors, `> ${this.flushErrors()}`)
      .build()
  }

  updateStatus(newStatus) {
    if (this.scriptStatus.id != newStatus.id) {
      this.logger.log(`Updating status: ${this.scriptStatus.name} -> ${newStatus.name}`)
      this.scriptStatus = newStatus;
    }
  }

  async updateScriptEntry() {
    if (!this.enabledStatus) {
      this.updateStatus(ScriptStatus.DISABLED);
    }
    if (this.shouldStop()) {
      this.stopScript();
    }
    try {
      await this.notion.updatePage(this.entry.id, this.getProps())
    }
    catch (error) {
      this.logger.log(`Error updating page ${this.entry.id}: ${error.message}\nProps: ${JSON.stringify(this.getProps())}`);
    }
  }

  async updateProps(newEntry = null) {
    if(!this.enabledStatus) return;
    if (newEntry != null) {
      this.entry = newEntry;
      this.props.addCheckbox(newEntry.properties[this.columnsSchema.enabledStatus].checkbox);
      this.enabledStatus = this.props.getCheckbox(this.columnsSchema.enabledStatus);
    }
  }
}

module.exports = { ScriptHelper };
