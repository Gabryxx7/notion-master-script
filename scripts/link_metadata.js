#!/usr/bin/env node
const { Client } = require("@notionhq/client")
// const config = require('./config.no-commit.json')
const urlMetadata = require('url-metadata')
const { Utils, MetadataHelper, PropsHelper, ParamsSchema, NotionHelper } = require('../utils.js')
const { ScriptStatus, ScriptEnabledStatus } = require('../ScriptStatus.js')

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
            type: 'Type',
            citation: 'Citation',
            pdfLink: 'PDF Link'
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
        this.entries = [];
        //     setInterval((databaseId) => getEntriesFromNotionDatabase(databaseId), 50000)
        //     updateUnprocessedEntries(databaseId)
        //     setInterval((databaseId) => updateUnprocessedEntries(databaseId), 3000)
    }

    async update() {
        this.entries = await this.notion.getDBEntries(this.databaseId)
        this.entries = this.entries
        .map((page) => this.processPage(page))
        .filter((p) => {
            return !p.status;
            // try {
            //     return (!p.status && ((p.link && p.link.url && p.link.url !== "") || p.title !== ""))
            //     // console.log(unprocessed.length > 0 ? `Found ${unprocessed.length} page(s) to process!` : `No new entries to process!`);
            // } catch (error) {
            //     this.scriptHelper.throwError("ERROR filtering pages!", error)
            //     console.log("ERROR filtering pages!", error)
            //     return false;
            // }
        })
        .map(async (entry) => await this.processUrlEntry(entry))
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
        return newPage
    }

    createUpdatePage(entry, metadata, createNew=false){
        if(!metadata) return;
        const authors = metadata.author.map((x) => { return { 'name': x } });
        var props = new PropsHelper(entry.page.properties)
            .addTitle(this.columnsSchema.title, metadata.title)
            .addMultiSelect(this.columnsSchema.author, authors)
            .addSelect(this.columnsSchema.type, metadata.type)
            .addLink(this.columnsSchema.link, metadata.url)
            .addLink(this.columnsSchema.pdfLink, metadata.pdfLink)
            .addRichText(this.columnsSchema.citation, metadata.citation)
            .addCheckbox(this.columnsSchema.status, true)
            .build()
            // console.log(`Updating entry with props: ${JSON.stringify(props)}, ${JSON.stringify(this.columnsSchema)}`)
        if(createNew){
            this.notion.createPage(
                NotionHelper.ParentType.DATABASE,
                this.databaseId,
                props)
            .catch((error) => { console.log("Error creating page!", error.message) })
        }
        else{
            this.notion.updatePage(entry.page.id,props)
                .catch((error) => { console.log("Error updating page!", error.message) })
        }
    }

    async processUrlEntry(entry) {
        const blocks = await this.notion.retrievePageBlocks(entry.page.id)
        var urls = blocks;
        if (entry.link.url && entry.link.url !== "") {
            urls = urls.concat(entry.link.url.split(/\n|,/))
        }
        urls = urls.concat(entry.title.split(/\n|,/))
        urls = urls.filter((x) => x != '');
        console.log(urls)
        if(urls.length <= 0) return;

        for (let [index, url] of urls.entries(urls)) {
            const metadata = await this.metadataHelper.getLinkMetadata(url);
            this.createUpdatePage(entry, metadata, index > 0);
        }
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
