
const { PropsHelper } = require('./PropsHelper')
// const NotionLinkUpdater = require("../scripts/link_metadata")
const { Logger } = require("./Logger.js");
const { Script } = require('vm');
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

const ScriptCodeBlocks = {
  PARAMS: "Parameters",
  ERRORS: "ERRORS"
}

class ScriptPage {
  static createScriptPage(entryId, notionHelper) {
    var defaultScriptPage = require("./defaultScriptPage.json");
    var addedPage = await notionHelper.createPageInPage(entryId, defaultScriptPage.page);
    addedPage = addedPage.results[0];
    var titleBlock = defaultScriptPage.page_blocks.title;
    var paramBlock = defaultScriptPage.page_blocks.parameters;
    var errorsBlock = defaultScriptPage.page_blocks.errors;
    var addedBlocks = await notionHelper.appendBlocks(addedPage.id, [titleBlock, paramBlock, errorsBlock])

    // var paramBlockLink = `https://www.notion.so/gabryxx7/${this.databaseId}-${codeBlock.parent.page_id.replaceAll("-", "")}#${codeBlock.id.replaceAll("-", "")}`;
    // var newProp = new PropsHelper().addLink(this.columnsSchema.scriptParams, paramBlockLink, true, "Parameters")
    //   await this.notionHelper.updatePage(this.entry.id, newProp.build())
  }
  constructor(notionHelper, scriptPage) {
    this.notionHelper = notionHelper;
    this.scriptPage = scriptPage;
    this.pageBlocks = null;
    this.parametersBlock = null;
    this.errorsBlock = null;
    this.getPageBlocks()
  }

  getPageBlocks(){
    var blocks = (await this.notionHelper.retrievePageBlocks(this.scriptPage.id)).results;
    for(var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.code && block.code.caption.length > 0) {
        var caption = block.code.caption[0].text.content;
        if(caption.includes(ScriptCodeBlocks.PARAMS)){
          this.parametersBlock = block;
        }
        else if(caption.includes(ScriptCodeBlocks.ERRORS)){
          this.errorsBlock = block;
        }
      }
    }
  }

  getParameters(){
    var jsonParams = JSON.parse(this.parametersBlock.code.text[0].plain_text);
    // fsPromises.writeFile(`./logs/${this.pageName}_Params_PRE.json`, JSON.stringify(jsonParams))
    jsonParams['databaseId'] = this.databaseId.replaceAll("-", "");
    return jsonParams;
  }

  updateErrors(errorsStr){
    var props = new PropsHelper().addText("code", errorsStr).build();
    await this.notion.updateBlock(this.errorsBlock.id, props);
  }

}

class ScriptHelper {
  constructor(scriptsManager, entry, scriptData, columnsSchema) {
    this.scriptsManager = scriptsManager;
    this.notionHelper = scriptsManager.notionHelper;
    this.scriptPage = null;
    this.errorsList = []
    this.entry = entry;
    this.columnsSchema = columnsSchema;
    this.props = new PropsHelper(entry.properties);
    this.scriptName = this.props.getSelect(this.columnsSchema.scriptId);
    this.scriptData = scriptData;
    this.scriptStatus = ScriptStatus.NONE;
    this.enabledStatus = this.props.getCheckbox(this.columnsSchema.enabledStatus);
    this.scriptInstance = null;
    this.scriptEntryId = null;
    this.pageName = "none";
    this.refreshTime = 3000;
    this.scriptId = `Entry ${entry.id} `
    try {
      this.databaseId = this.props.getText(this.columnsSchema.pageId);
      this.pageName = this.props.getTitle(this.columnsSchema.pageName)
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

  async getScriptPage() {
    if(this.scriptPage) return this.scriptPage
    var blocks = (await this.notionHelper.retrievePageBlocks(this.entry.id)).results;
    if(blocks){
      for(var i = 0; i < blocks.length; i++) {
        var block = blocks[i];
        if(block.hasOwnProperty("child_page")){
          if(block.child_page.title.includes(this.scriptName)){
            this.scriptPage = new ScriptPage(block)
            return this.scriptPage;
          }
        }
      }
    }
    this.scriptPage = ScriptPage.createScriptPage(this.entry.id)
  }

  async createScriptInstance() {
    try {
      this.logger.log(`*** Instantiating ${this.scriptData.className} for [${this.scriptId}] ***`)
      var params = await this.scriptPage.getParameters();
      params = this.scriptData.class.paramsSchema.checkParams(params);
      this.refreshTime = params['refreshTime'] ? params['refreshTime'] : this.refreshTime;
      this.scriptInstance = new this.scriptData.class(this, this.notionHelper, params);
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
    this.notionHelper.getSingleDbEntry(this.masterDatabaseID, this.columnsSchema.pageId, this.databaseId)
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
    this.scriptPage.updateErrors(this.flushErrors());
    var updatedProps = new PropsHelper()
      .addStatus(this.columnsSchema.runningStatus, this.scriptStatus.name)
      .addCheckbox(this.columnsSchema.enabledStatus, this.enabledStatus)
      // .addRichText(this.columnsSchema.errors, `> ${this.flushErrors()}`)
      .build()
    try {
      await this.notionHelper.updatePage(this.entry.id, updatedProps)
    }
    catch (error) {
      this.logger.log(`Error updating page ${this.entry.id}: ${error.message}\nProps: ${JSON.stringify(updatedProps)}`);
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
