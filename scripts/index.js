#!/usr/bin/env node
const dotenv = require("dotenv")
dotenv.config()
const config = require('../config.no-commit.json')
const sleep = require("timers/promises").setTimeout;

const { NotionHelper } = require("../Helpers/NotionHelper.js")
const { PropsHelper } = require("../Helpers/PropsHelper.js")
const { ScriptHelper } = require("../Helpers/ScriptHelper.js")
var { Logger, cleanLogs } = require("../Helpers/Logger.js")
const { NotionLinkUpdater } = require("./link_metadata.js")


const notionHelper = new NotionHelper(config.NOTION_KEY);
const updater = new NotionLinkUpdater(null, notionHelper, {});

const updateLoop = () => {
    updater.update()
        .then(() => updater.logger.log(`Database updated! ${updater.databaseId}`))
        .catch((error) => updater.logger.log(`Error updating database ${updater.databaseId}`, error))
        .finally(() => setTimeout(updateLoop, updater.refreshTime))
}

updateLoop();