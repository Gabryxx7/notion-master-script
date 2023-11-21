#!/usr/bin/env node
const sleep = require("timers/promises").setTimeout;
const urlMetadata = require('url-metadata')
const axios = require('axios');
const cheerio = require("cheerio"); 
const Cite = require('citation-js')
const { PropsHelper } = require('../Helpers/PropsHelper.js')
const { ParamsSchema } = require('../Helpers/ParamsHelpers.js')
var { Logger, cleanLogs } = require("../Helpers/Logger.js")
const fsPromises = require('fs').promises;
const LINK_SPLIT_REGEX = /\n|,|(?=https)|(?=http)/;

const citationCharLimit = 2000;
const cols = {
    added: 'Date Added',
    status: "Script Processed",
    title: "Name",
    author: "Author/Channel",
    pdfLink: "PDF",
    link: "Link",
    type: "Type",
    bibtexCitation: "BibTex",
    APACitation: "APA",
    scihubLink: "Sci-Hub Link",
    index: "ID"
}
const defaultParams = {
    databaseId: "bd245688bc904c49be07c87e0619b49f",
    scihubUrl: "https://sci-hub.ru",
    refreshTime: 20000,
    columns: cols,
    index_col: cols.added
}

class MetadataHelper {
    static SCIHUB_URL = "https://sci-hub.ru";
    constructor(logger=null, scihubUrl=null){
        this.scihubUrl = scihubUrl == null ? MetadataHelper.SCIHUB_URL : scihubUrl;
        if(!logger)
            this.logger = console;
        else
            this.logger = logger;
    }

    async getLinkMetadata(url) {
        this.logger.log(`Getting metadata for ${url}`)
        let data = {};
        let type = "";
        try{
            if (url.toLowerCase().includes("youtu")) {
                data = await this.getYoutubeMetadata(url);
                type = "Youtube";
            }
            else if (url.toLowerCase().includes("doi")) {
                data = await this.getDOIMetadata(url)
                type = "DOI";
            }
            else {
                data = await this.getURLMetadata(url)
                type = "URL";
            }
        }
        catch(error){
            this.logger.log(`Error getting metadata for ${url}: ${error.message}`);
        }
        if(!data) return null;
        data['url'] = url;
        return data;
    }
    
    async getYoutubeMetadata(url) {
        const requestUrl = `https://youtube.com/oembed?url=${url}&format=json`;
        try {
            let data = await axios.get(requestUrl);
            data = data.data;
            return {
                title: data.title,
                author: [data.author_name],
                type: "Video"
            }
        }
        catch (error) {
            this.logger.log(`Error YouTube metadata ${error.message}`);
        };
    }

    async getScihubPDFLink(scihubUrl){
        const pageHTML = await axios.get(scihubUrl);
        const $ = cheerio.load(pageHTML.data);
        var pdfUrl = null;
        $("#buttons button").each((index, element) => { 
            pdfUrl = $(element).attr("onclick") ;
        });
        if(pdfUrl){
            pdfUrl = pdfUrl.replace("location.href=","").replaceAll("'", "")
            if(pdfUrl.includes("sci-hub.")){
                pdfUrl = `https://${pdfUrl.replace("//", "")}`;
            }
            else{
                pdfUrl = `${this.scihubUrl}${pdfUrl}`;
            }
        }
        return pdfUrl
    }

    async getDOIMetadata(url) {
        try {
            const citation = await Cite.input(url);
            const citationJSON = citation[0];
            const citationObj = new Cite(citation);
            let abstract = citationObj.data[0]?.abstract;
            let bibtexCit = citationObj.format('biblatex')

            if(bibtexCit.length > citationCharLimit && abstract){
                const toRemove = (bibtexCit.length - citationCharLimit) + 1;
                citationObj.data[0].abstract = abstract.substring(0, abstract.length-toRemove) 
                bibtexCit = citationObj.format('biblatex');
                this.logger.log(`Citation over ${citationCharLimit} chars: Limiting abstract to ${abstract.length-toRemove} chars. Total chars in the end: ${bibtexCit.length} `)
            }
            const apaCit = citationObj.format('citation', {
                template: 'apa'
            })
            const scihubUrl = `${this.scihubUrl}/${url}`;
            var scihubPdfLink = null;
            try{
                scihubPdfLink = await this.getScihubPDFLink(scihubUrl)
            }
            catch(error){
                this.logger.log(`Error getting scihub PDF link ${error.message}`)
            }
            scihubPdfLink = (!scihubPdfLink || scihubPdfLink.includes('null')) ? scihubUrl : scihubPdfLink;
            this.logger.log(`SCIHUB pdf Link for ${scihubUrl}: ${scihubPdfLink}`)
            return {
                title: citationJSON.title,
                author: (citationJSON.author ?? citationJSON.editor)?.map((x) => x.given + " " + x.family) ?? "",
                type: "Paper",
                bibtexCitation: bibtexCit,
                APACitation: apaCit,
                scihubLink: scihubUrl,
                pdfLink: scihubPdfLink
            }
        }
        catch (error) {
            this.logger.log(`Error DOI metadata for ${url}: ${error.error}, ${error.message}`);
            return null;
        }
    }


    async getURLMetadata(url) {
        try {
            const data = await urlMetadata(url);
            return {
                title: data['og:title'] !== "" ? data['og:title'] : data.title,
                author: [data['og:site_name'] !== "" ? data['og:site_name'] : data.author !== "" ? data.author : data.source],
                type: "Post"
            }
        }
        catch (error) {
            this.logger.log(`Error getting URL metadata for ${url}: ${error.error}, ${error.message}`);
        };
    }

}

class NotionLinkUpdater {
    static paramsSchema = new ParamsSchema()
        .addParam("databaseId", true)
        .addParam("scihubUrl", false, MetadataHelper.SCIHUB_URL)
        .addParam("columns", false, defaultParams.columns)
        .addParam("refreshTime", false, 5000);
    // Name: Needed?
    constructor(scriptHelper, notion, params) {
        this.scriptHelper = scriptHelper;
        this.initialized = false;
        this.logger = this.scriptHelper?.logger ?? new Logger("NotionLinkMetadata");
        this.notion = notion;
        this.params = {...defaultParams, ...params};
        this.refreshTime = this.params?.refreshTime ?? defaultParams.refreshTime;
        this.metadataHelper = new MetadataHelper(this.logger, this.params.scihubUrl);
        this.databaseId = this.params.databaseId;
        this.databasePage = null;
        this.columns = this.params.columns ?? columns;
        this.entries = [];
        //     setInterval((databaseId) => getEntriesFromNotionDatabase(databaseId), 50000)
        //     updateUnprocessedEntries(databaseId)
        //     setInterval((databaseId) => updateUnprocessedEntries(databaseId), 3000)
    }

    async update() {
        // this.logger.log(`Getting Link metadata DB entries`)
        try{
            const sorts = [{
                property: this.columns.added,
                direction: "descending"
            }]
            this.entries = await this.notion.getDBEntries(this.databaseId, sorts);
        } catch(error){
            this.logger.log(`Error getting updated DB entries for link-metadata database ${this.databaseId}`, error);
        }
        this.entries = this.entries.sort(p => p.props[cols.added]);
        if(!this.initialized){
            this.databasePage = await this.notion.getDBPage(this.databaseId);
            this.logger.log(`Starting on database '${this.databasePage?.title[0]?.plain_text}' (${this.databaseId}) with a total of ${this.entries.length} entries`)
            this.databasePage.entries = this.entries;
            fsPromises.writeFile(`./${this.databaseId}_data.json`, JSON.stringify(this.databasePage));
            this.initialized = true;
        }
        const unprocessed = this.entries?.filter(p => {
            // console.log(p.props);
            return !p.props[cols.status];
        });
        const lastId = !this.entries ? 0 : this.entries.map(p => p.props[cols.index]).reduce((x, y) => x > y ? x : y) ?? 0;
        unprocessed.length > 0 && this.logger.log(`Found ${unprocessed.length} NEW entries, lastID`, lastId);
        this.entries.map((page, i) => {
            this.processPage(page, this.entries.length - i)
                    .catch((error) => this.logger.log(`Error processing Page ${page.props[cols.title]}`, error))
        })
    }

    createUpdatePage(page, metadata, createNew=false, rowIndex=null){
        this.logger.log(`Updating page ${page.id}`);
        if(!metadata) return;
        let authors = null;
        try{
            authors = metadata.author?.map((x) => { return { 'name': x } });
        } catch(error) {
            this.logger.log(`Error getting authors names : ${error}`)
        }
        var props = page.props
            .addTitle(this.columns.title, metadata.title)
            .addMultiSelect(this.columns.author, authors)
            .addSelect(this.columns.type, metadata.type)
            .addLink(this.columns.link, metadata.url)
            .addLink(this.columns.scihubLink, metadata.scihubLink)
            .addLink(this.columns.pdfLink, metadata.pdfLink, true, "PDF")
            .addRichText(this.columns.bibtexCitation, metadata.bibtexCitation)
            .addRichText(this.columns.APACitation, metadata.APACitation)
            .addCheckbox(this.columns.status, true)
            .addNumber(this.columns.index, rowIndex)
            .build()
            this.logger.log(`Updating page with props: ${JSON.stringify(props)}, ${JSON.stringify(this.columns)}`)
        if(createNew){
            this.notion.createPageInDb(this.databaseId, props)
                .catch((error) => { this.logger.error("Error creating page!", error.message) })
                .then(() => {this.logger.log(`Created new page for: ${metadata.url} (${metadata.title})`)})
        }
        else{
            this.notion.updatePage(page.id, props)
                .catch(error => this.logger.error("Error updating page!", error.message))
                .then(() => this.logger.log(`Updated page for: ${metadata.url} (${metadata.title})`))
        }
    }

    async getBlocksData(blockList){
        var blocks = [];
        for(var block of blockList){
            let blockData = await this.notion?.blocks?.retrieve({
                block_id: block.id
            }) ?? block;
            await sleep(250)
            try{
                for(var blockText of blockData.paragraph.text){
                    var urls = blockText.plain_text.split(LINK_SPLIT_REGEX);
                    blocks = blocks.concat(urls)
                }
            }
            catch(error){
                console.error(`Error getting text from page: ${error}`)
            }
        }
        return blocks;
    }

    async processPage(page, rowIndex) {
        const title = page.props[cols.title];
        if(!page.props[cols.status]){
            // const pageBlocks = await this.notion.retrievePageBlocks(page.id)
            // const blocks = await this.getBlocksData(pageBlocks.results);
            // var urls = blocks;
            let urls = [];
            var linksUrls = [];
            try{
                linksUrls.push(page.props[cols.link], ...title)
            } catch(error){}
            linksUrls = linksUrls.join('').split(LINK_SPLIT_REGEX)
            urls = urls.concat(linksUrls).filter((x) => x != '');
            urls?.forEach(x => this.logger.log(x))
            if(urls.length <= 0) return;
            urls.forEach((url, i) => this.metadataHelper.getLinkMetadata(url)
                .then(metadata => this.createUpdatePage(page, metadata, i > 0, rowIndex+i))
                .catch(error => this.logger.error(`Error updating page ${page.id}`, error))
            )
        } else {
            // this.logger.log(`Skipping processed page: ${title}`)
            if(!page.props[cols.index]){
                this.notion.updatePage(page.id, page.props.addNumber(cols.index, rowIndex).build())
                    .catch(error => this.logger.error(`Error updating ID for page ${title}`, error))
                    .then(() => this.logger.log(`Updated ID for: ${title}`))
            }
        }
    }
}

module.exports = { NotionLinkUpdater, MetadataHelper }

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
