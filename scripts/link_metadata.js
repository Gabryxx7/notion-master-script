#!/usr/bin/env node
const { Client } = require("@notionhq/client")
// const config = require('./config.no-commit.json')
const urlMetadata = require('url-metadata')
const { Utils, MetadataHelper, PropsHelper, ParamsSchema, ScriptStatus, ScriptEnabledStatus } = require('../utils.js')

// const databaseId = config.NOTION_DATABASE_ID

module.exports = class NotionLinkUpdater {
    static paramsSchema = new ParamsSchema()
        .addParam("databaseId", true)
        .addParam("columns", false,
        {
            status: 'Script Processed',
            title: 'Name',
            author: 'Author/Channel',
            link: 'Link',
            type: 'Type'
        })
        .addParam("refreshTime", false, 5000);
    // Name: Needed?
    constructor(scriptHelper, notion, params) {
        this.scriptHelper = scriptHelper;
        this.metadataHelper = new MetadataHelper();
        this.notion = notion;
        this.params = params;
        this.databaseId = this.params.databaseId;
        this.columnsSchema = this.params.columns;
        this.refreshTime = params['refreshTime'];
        this.entries = [];
        this.entriesUpdater = null;
        //     setInterval((databaseId) => getEntriesFromNotionDatabase(databaseId), 50000)
        //     updateUnprocessedEntries(databaseId)
        //     setInterval((databaseId) => updateUnprocessedEntries(databaseId), 3000)
    }

    start() {
        this.update(true)
    }

    stop() {
        if (this.entriesUpdater != null){
            clearTimeout(this.entriesUpdater)
        }
    }
    

    update(loop = false) {
        this.scriptHelper.updateStatus(ScriptStatus.RUNNING);
        this.entries = this.notion.getDBEntries(this.databaseId)
            .then((pages) => {
                this.entries =
                    pages
                        .map((page) => this.processPage(page))
                        .filter((p) => {
                            console.log(p.status, p.link, p.title)
                            try {
                                return (!p.status && ((p.link && p.link.url && p.link.url !== "") || p.title !== ""))
                                // console.log(unprocessed.length > 0 ? `Found ${unprocessed.length} page(s) to process!` : `No new entries to process!`);
                            } catch (error) {
                                this.scriptHelper.throwError("ERROR filtering pages!", error)
                                console.log("ERROR filtering pages!", error)
                                return false;
                            }
                        })
                        .map((entry) => this.updateEntry(entry))
                if (loop) {
                    this.entriesUpdater = setTimeout(() => this.update(true), this.refreshTime)
                }
                else{
                    this.scriptHelper.updateStatus(ScriptStatus.STOPPED);
                }
            });
    }

    processPage(page) {
        const statusProperty = this.columnsSchema.status in page.properties ? page.properties[this.columnsSchema.status] : null;
        const status = statusProperty ? statusProperty.checkbox : false;
        const title = this.columnsSchema.title in page.properties ?
            page.properties[this.columnsSchema.title].title.map(({ plain_text }) => plain_text).join("") : null;
        const link =  this.columnsSchema.link in page.properties ? page.properties[this.columnsSchema.link] : null;
        const author =  this.columnsSchema.author in page.properties ? page.properties[this.columnsSchema.author].multi_select : null;
        // console.log(`Link ${link}`);
        const newPage = {
            page: page,
            status,
            title,
            author,
            link,
        };
        console.log(newPage)
        return newPage
    }

    updateEntry(entry) {
        // console.log(entry)
        this.metadataHelper.getLinkMetadata(entry).then((metadata) => {
            const authors = metadata.author.map((x) => { return { 'name': x } });
            var props = new PropsHelper()
                .addTitle(this.columnsSchema.title, metadata.title)
                .addMultiSelect(this.columnsSchema.author, authors)
                .addSelect(this.columnsSchema.type, metadata.type)
                .addLink(this.columnsSchema.link, metadata.url)
                .build()
                console.log("Updating entry with props: ", props, this.columnsSchema)
            this.notion.updatePage(
                entry.page.id,
                props)
                .then((response) => {
                    var props = new PropsHelper()
                        .addCheckbox(this.columnsSchema.status, true)
                        .build()
                    this.notion.updatePage( entry.page.id, props)
                        .catch((error) => { console.log("Error updating page AGAIN!", error.message) })
                })
                .catch((error) => { console.log("Error updating page!", error.message) })
        });
    }
}

// config.NOTION_DATABASE_IDs.forEach((databaseId) =>
//   {
//     // /**
//     //  * Initialize local data store.
//     //  * Then poll for changes every 5 seconds (5000 milliseconds).
//     //  */
//     setInterval((databaseId) => getEntriesFromNotionDatabase(databaseId), 50000)
//     updateUnprocessedEntries(databaseId)
//     setInterval((databaseId) => updateUnprocessedEntries(databaseId), 3000)
//   });
