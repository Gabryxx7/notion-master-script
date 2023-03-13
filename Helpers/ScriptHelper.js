
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
  constructor(notion, entry, scriptData, masterDatabaseID, columnsSchema) {
    this.notion = notion;
    this.masterDatabaseID = masterDatabaseID;
    this.errorsList = []
    this.entry = entry;
    this.columnsSchema = columnsSchema;
    this.props = new PropsHelper(entry.properties);
    this.scriptName = this.props.getSelect(this.columnsSchema.scriptId);
    this.scriptData = scriptData;
    this.scriptStatus = ScriptStatus.NONE;
    this.enabledStatus = this.props.getCheckbox(this.columnsSchema.enabledStatus);
    this.scriptInstance = null;
    this.databaseId = null;
    this.pageName = "none";
    this.refreshTime = 3000;
    this.scriptId = `Entry ${entry.id} `
    try {
      this.databaseId = this.props.getTitle(this.columnsSchema.pageId);
      this.pageName = this.props.getText(this.columnsSchema.pageName)
      this.scriptId = `${this.pageName} (${this.scriptName})`
    } catch (error) {
      this.throwError(`No page/database ID found, does this page/db exist? Was it added manually?`)
    }
    this.logger = new Logger(this.scriptId)
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
    // this.logger.log(`**** [${this.pageName}] FLUSHING ERRORS ****\n${ret}\n`)
    this.errorsList = [];
    return ret;
  }

  getParamsCodeBlock(blocks, caption="params_json") {
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
    try {
      var blocks = await this.notion.retrievePageBlocks(this.entry.id);
      blocks = blocks.results;
      // fsPromises.writeFile(`./logs/${this.pageName}_Blocks.json`, JSON.stringify(blocks))
      codeBlock = this.getParamsCodeBlock(blocks);
      // fsPromises.writeFile(`./logs/${this.pageName}_ParamsBlock.json`, JSON.stringify(codeBlock))
      if(!codeBlock){
        var defBlockList = require("./defaultScriptPage.json");
        defBlockList[1].code.text[0].text.content = this.scriptData.class.paramsSchema.toString();
        var addedBlocks = await this.notion.appendBlocks(this.entry.id, defBlockList);
        addedBlocks = addedBlocks.results[0];
        // fsPromises.writeFile(`./logs/${this.pageName}_AddedBlocks.json`, JSON.stringify(addedBlocks))
        codeBlock = this.getParamsCodeBlock(addedBlocks);
        // fsPromises.writeFile(`./logs/${this.pageName}_ParamsAddedBlock.json`, JSON.stringify(codeBlock))
      }
      var paramBlockLink = `https://www.notion.so/gabryxx7/${this.databaseId}-${codeBlock.parent.page_id.replaceAll("-", "")}#${codeBlock.id.replaceAll("-", "")}`;
      var newProp = new PropsHelper().addLink(this.columnsSchema.scriptParams, paramBlockLink, true, "Parameters")
      await this.notion.updatePage(this.entry.id, newProp.build())
    } catch (error) {
      this.throwError("No parameters found", error)
    }
    var jsonParams = JSON.parse(codeBlock.code.text[0].plain_text);
    // fsPromises.writeFile(`./logs/${this.pageName}_Params_PRE.json`, JSON.stringify(jsonParams))
    jsonParams['databaseId'] = this.databaseId.replaceAll("-", "");
    // fsPromises.writeFile(`./logs/${this.pageName}_Params_POST.json`, JSON.stringify(jsonParams))
    return jsonParams;
  }

  async createScriptInstance() {
    try {
      this.logger.log(`*** Instantiating ${this.scriptData.className} for [${this.scriptId}] ***`)
      var params = await this.getParamsJson();
      params = this.scriptData.class.paramsSchema.checkParams(params);
      this.refreshTime = params['refreshTime'] ? params['refreshTime'] : this.refreshTime;
      this.scriptInstance = new this.scriptData.class(this, this.notion, params);
    } catch (error) {
      this.throwError(`Error instantiating ${this.scriptData.className} for [${this.scriptId}] `, error);
    }
    return this.scriptInstance;
  }

  shouldStop() {
    return ([ScriptStatus.STOPPED.id, ScriptStatus.DISABLED.id, ScriptStatus.ERROR.id].includes(this.scriptStatus.id) || !this.enabledStatus)
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
    // this.logger.log(`Update`)
    if(this.scriptInstance != null) this.scriptInstance.update();
    this.notion.getUpdatedDBEntry(this.masterDatabaseID, this.columnsSchema.pageId, this.databaseId)
      .then(async (res) => {
        // this.logger.log(`Updated db entry : ${res.results.length}`)
        // this.logger.log(res.results[0])
        await this.updateProps(res.results[0]);
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
    if (newEntry != null) {
      this.entry = newEntry;
      this.props.addCheckbox(newEntry.properties[this.columnsSchema.enabledStatus].checkbox);
      this.enabledStatus = this.props.getCheckbox(this.columnsSchema.enabledStatus);
    }
  }
}

module.exports = { ScriptHelper };
