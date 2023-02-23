#!/usr/bin/env node
const { Client } = require("@notionhq/client")
// const config = require('./config.no-commit.json')
const axios = require('axios');
const Cite = require('citation-js')
const urlMetadata = require('url-metadata')
const { Utils, MetadataHelper, ParamsSchema, ScriptStatus, ScriptEnabledStatus } = require('../utils.js')

// const databaseId = config.NOTION_DATABASE_ID

module.exports = class NotionLinkUpdater {
    static paramsSchema = new ParamsSchema()
        .addParam("databaseId", true)
        .addParam("refreshTime", false, 5000);
    // Name: Needed?
    constructor(scriptHelper, notion, params) {
        this.scriptHelper = scriptHelper;
        this.notion = notion;
        this.params = params;
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
            .then((pages) => pages.map(page => processPage(page)));

        this.entries
            .filter((pages) => {
                try {
                    return pages.filter((p) => (!p.status && ((p.link && p.link.url && p.link.url !== "") || p.title !== "")))
                    // console.log(unprocessed.length > 0 ? `Found ${unprocessed.length} page(s) to process!` : `No new entries to process!`);
                } catch (error) {
                    this.scriptHelper.throwError("ERROR filtering pages!", error)
                    console.log("ERROR filtering pages!", error)
                    return false;
                }
            })
            .map((entry) => updateEntry(entry))

        if (loop) {
            this.entriesUpdater = setTimeout(() => update(true), this.refreshTime)
        }
        else{
            this.scriptHelper.updateStatus(ScriptStatus.STOPPED);
        }
    }

    processPage(page) {
        const statusProperty = page.properties["Script Processed"];
        const status = statusProperty ? statusProperty.checkbox : false;
        const title = page.properties["Name"].title
            .map(({ plain_text }) => plain_text)
            .join("");
        const link = page.properties["Link"]
        const author = page.properties["Author/Channel"].multi_select
        // console.log(`Link ${link}`);
        return {
            page: page,
            status,
            title,
            author,
            link,
        };
    }

    async updateEntry(entry) {
        // console.log(entry)
        MetadataHelper.getLinkMetadata(entry).then((metadata) => {
            const authors = metadata.author.map((x) => { return { 'name': x } });
            let updatedPage = {
                page_id: entry.page.id,
                properties: {
                    'Name': {
                        title: [
                            {
                                text: {
                                    content: metadata.title
                                }
                            }
                        ]
                    },
                    'Author/Channel': {
                        multi_select: authors
                    },
                    'Type': {
                        select:
                        {
                            name: metadata.type
                        }
                    },
                    'Link': {
                        url: metadata.url
                    }
                }
            };
            console.log(updatedPage)
            notion.pages
                .update(updatedPage)
                .then((response) => {
                    updatedPage = {
                        page_id: entry.page.id,
                        properties: {
                            'Script Processed': {
                                checkbox: true
                            }
                        }
                    };
                    response = notion.pages.update(updatedPage)
                        .then((response) => {console.log("Page updated!", response)})
                        .catch((error) => { console.log("Error updating page AGAIN!", error) });
                }).catch((error) => { console.log("Error updating page!", error) });
        }).catch((error) => { console.log("Error getting link metadata!", error) });
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



