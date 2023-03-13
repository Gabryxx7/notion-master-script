#!/usr/bin/env node
const urlMetadata = require('url-metadata')
const axios = require('axios');
const cheerio = require("cheerio"); 
const Cite = require('citation-js')
const { PropsHelper } = require('../Helpers/PropsHelper.js')
const { ParamsSchema } = require('../Helpers/ParamsHelpers.js')
const LINK_SPLIT_REGEX = /\n|,|(?=https)|(?=http)/;

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
            const bibtexCit = citationObj.format('bibtex')
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
            this.logger.log(`SCIHUB pdf Link for ${scihubUrl}: ${scihubPdfLink}`)
            return {
                title: citationJSON.title,
                author: citationJSON.author.map((x) => x.given + " " + x.family),
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
        .addParam("columns", false,
        {
            status: 'Script Processed',
            title: 'Name',
            author: 'Author/Channel',
            link: 'Link',
            type: 'Type',
            bibtexCitation: 'BibTex Citation',
            APACitation: 'APA Citation',
            scihubLink: 'Sci-Hub Link',
            pdfLink: 'PDF Link'
        })
        .addParam("refreshTime", false, 5000);
    // Name: Needed?
    constructor(scriptHelper, notion, params) {
        this.scriptHelper = scriptHelper;
        this.logger = this.scriptHelper.logger;
        this.notion = notion;
        this.params = params;
        this.metadataHelper = new MetadataHelper(this.logger, this.params.scihubUrl);
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
            //     // this.logger.log(unprocessed.length > 0 ? `Found ${unprocessed.length} page(s) to process!` : `No new entries to process!`);
            // } catch (error) {
            //     this.scriptHelper.throwError("ERROR filtering pages!", error)
            //     this.logger.log("ERROR filtering pages!", error)
            //     return false;
            // }
        })
        .map(async (entry) => this.processUrlEntry(entry))
    }

    processPage(page) {
        const statusProperty = this.columnsSchema.status in page.properties ? page.properties[this.columnsSchema.status] : null;
        const status = statusProperty ? statusProperty.checkbox : false;
        const title = this.columnsSchema.title in page.properties ?
            page.properties[this.columnsSchema.title].title.map(({ plain_text }) => plain_text).join("") : null;
        const link =  this.columnsSchema.link in page.properties ? page.properties[this.columnsSchema.link] : null;
        const author =  this.columnsSchema.author in page.properties ? page.properties[this.columnsSchema.author].multi_select : null;
        // this.logger.log(`Link ${link}`);
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
        var props = new PropsHelper(null, entry.page.properties)
            .addTitle(this.columnsSchema.title, metadata.title)
            .addMultiSelect(this.columnsSchema.author, authors)
            .addSelect(this.columnsSchema.type, metadata.type)
            .addLink(this.columnsSchema.link, metadata.url)
            .addLink(this.columnsSchema.scihubLink, metadata.scihubLink)
            .addLink(this.columnsSchema.pdfLink, metadata.pdfLink, true, "PDF")
            .addRichText(this.columnsSchema.bibtexCitation, metadata.bibtexCitation)
            .addRichText(this.columnsSchema.APACitation, metadata.APACitation)
            .addCheckbox(this.columnsSchema.status, true)
            .build()
            // this.logger.log(`Updating entry with props: ${JSON.stringify(props)}, ${JSON.stringify(this.columnsSchema)}`)
        if(createNew){
            this.notion.createPageInDb(this.databaseId, props)
                .catch((error) => { this.logger.error("Error creating page!", error.message) })
                .then(() => {this.logger.log(`Created new page for: ${metadata.url} (${metadata.title})`)})
        }
        else{
            this.notion.updatePage(entry.page.id,props)
                .catch((error) => { this.logger.error("Error updating page!", error.message) })
                .then(() => {this.logger.log(`Updated page for: ${metadata.url} (${metadata.title})`)})
        }
    }

    async getBlocksData(blockList){
        var blocks = [];
        for(var block of blockList){
            const blockData = await this.notion.blocks.retrieve({
                block_id: block.id
            });
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

    async processUrlEntry(entry) {
        this.logger.log(`Found new entries to process. Using regex: ${LINK_SPLIT_REGEX}`)
        const pageBlocks = await this.notion.retrievePageBlocks(entry.page.id)
        const blocks = await this.getBlocksData(pageBlocks.results);
        
        var urls = blocks;
        var linksUrls = [];
        try{
            linksUrls = entry.link.url.split(LINK_SPLIT_REGEX)
        }
        catch(error){
        }
        if(linksUrls.length <= 0){
            linksUrls = entry.title.split(LINK_SPLIT_REGEX)
        }
        urls = urls.concat(linksUrls)
        urls = urls.filter((x) => x != '');
        this.logger.log(urls)
        if(urls.length <= 0) return;

        for (let [index, url] of urls.entries(urls)) {
            const metadata = await this.metadataHelper.getLinkMetadata(url);
            this.createUpdatePage(entry, metadata, index > 0);
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
