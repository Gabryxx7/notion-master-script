
const axios = require('axios');
const cheerio = require("cheerio"); 
const Cite = require('citation-js')
const sleep = require("timers/promises").setTimeout;
const urlMetadata = require('url-metadata')


const LINK_SPLIT_REGEX = /\n|,|(?=https)|(?=http)/;

function fmt(date, format = 'YYYY-MM-DD hh:mm:ss') {
    const pad2 = (n) => n.toString().padStart(2, '0');
  
    const map = {
      YYYY: date.getFullYear(),
      MM: pad2(date.getMonth() + 1),
      DD: pad2(date.getDate()),
      hh: pad2(date.getHours()),
      mm: pad2(date.getMinutes()),
      ss: pad2(date.getSeconds()),
    };
  
    return Object.entries(map).reduce((prev, entry) => prev.replace(...entry), format);
  }

class PropsHelper{
    constructor(pageProps=null){
        this.props = {}
        this.pageProps = pageProps;
    }
    isPropInDB(propName){
        if(!this.pageProps) return true;
        return propName in this.pageProps;
    }
    addStatus(propName, statusName){
        if(!this.isPropInDB(propName)) return this;
        if(!statusName) return this;
        this.props[propName] = { status: { name: statusName}};
        return this;
    }
    addCheckbox(propName, ticked){
        if(!this.isPropInDB(propName)) return this;
        this.props[propName] = { checkbox: ticked };
        return this;
    }
    addRichText(propName, textContent){
        if(!this.isPropInDB(propName)) return this;
        if(!textContent) return this;
        this.props[propName] = { rich_text: [{text: { content: textContent}}]};
        return this;
    }
    addTextLink(propName, url, title=null) {
        if(!this.isPropInDB(propName)) return this;
        if(!url) return this;
        if(!title) title = url;
        this.props[propName] = { rich_text: [{text: { content: title, link: {url: url}}}]};
        return this;
    }
    addTitle(propName, textContent) {
        if(!this.isPropInDB(propName)) return this;
        if(!textContent) return this;
        this.props[propName] = { title: [{ text: { content: textContent }}] }
        return this;
    }
    addMultiSelect(propName, namesList){
        if(!this.isPropInDB(propName)) return this;
        this.props[propName] = { multi_select: namesList}
        return this;
    }
    addSelect(propName, selectedName) {
        if(!this.isPropInDB(propName)) return this;
        if(!selectedName) return this;
        this.props[propName] = { select: { name: selectedName}}
        return this;
    }
    addLink(propName, url) {
        if(!this.isPropInDB(propName)) return this;
        if(!url) return this;
        this.props[propName] = {url: url}
        return this;
    }
    build(){
        return this.props;
    }
}

class NotionHelper{
    static ParentType = {
        DATABASE: {field_name: 'database_id'}
    }
    constructor(notionRef){
        this.notion = notionRef;
    }


        // var res = {};
        // (async () => {
        // const databaseId = '115ed0a663464617b95cea9edf71d34a';
        // const idFieldName = 'Page ID';
        // const attachedDBId = 'ae32ca24-0afd-4cb0-8445-972f4e01139f';
        // const response = await notion.databases.query({
        //     database_id: databaseId,
        //     filter: {
        //     property: idFieldName,
        //     rich_text: {
        //         contains: attachedDBId
        //     }
        // }
        // });
        // res = response;
        // console.log(response);
        // })();

    async getUpdatedDBEntry(masterDbId, idFieldName, attachedDbId){
        return this.notion.databases.query({
            database_id: masterDbId,
            filter: {
                property: idFieldName,
                rich_text: {
                    contains: attachedDbId
                }
            }
        });
    }

    async getDBEntries(dbId) {
        const pages = [];
        let cursor = undefined;

        while (true) {
            const { results, next_cursor } = await this.notion.databases.query({
                database_id: dbId,
                start_cursor: cursor,
            })
            pages.push(...results)
            if (!next_cursor) {
                break
            }
            cursor = next_cursor;
        }
        return pages
    }

    retrievePage(pId){
        return this.notion.pages.retrieve({
            page_id: pId
        });
    }

    async retrievePageBlocks(bId){
        console.log("Waiting for children list")
        const response = await this.notion.blocks.children.list({
            block_id: bId,
            page_size: 50,
        });
        var blocks = [];
        for(var block of response.results){
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

    retrieveBlock(bId){
        return this.notion.blocks.retrieve({
            block_id: bId
        });
    }

    updatePage(pId, props, respHandler=null, errorHandler=null){
        return this.notion.pages.update({
            page_id: pId,
            properties: props
        });
    }

    createPage(pType, pId, props){
        var parentData = {type: pType.field_name}
        parentData[pType.field_name] = pId;
        return this.notion.pages.create({
                parent: parentData,
                properties: props
            })
    }

    deletePage(pId, respHandler=null, errorHandler=null){
        return this.notion.pages.update({
            page_id: pId,
            archived: true
        });
    }

    getAttachedDBs(respHandler=null, errorHandler=null){
        return this.notion.search({
            filter: { value: 'database', property: 'object'}
        })
    }
}


class ParamsSchema{
    constructor(){
        this.paramsData = {};
    }
    addParam(name, needed, defaultVal=null){
        this.paramsData[name] = {"name": name, "needed": needed, "defaultVal": defaultVal}
        return this;
    }
    getParam(name){
        if(name in this.paramsData){
            return this.paramsData[name]
        }
        return null;
    }

    checkParams(params){
        for (const [paramName, sParam] of Object.entries(this.paramsData)) {
            if(!params.hasOwnProperty(sParam.name)){
                if(sParam.needed){
                    throw new Error(`${sParam.name} is required`);
                }
                params[sParam.name] = sParam.defaultVal;
            }
            else{
                var addedParams = [];
                if (params[sParam.name].constructor == Object){
                    for (const [defaultParamName, defaultParam] of Object.entries(sParam.defaultVal)){
                        if(!params[sParam.name].hasOwnProperty(defaultParamName)){
                            // console.log(`Adding default param: ${defaultParamName}`)
                            addedParams.push(defaultParamName)
                            params[sParam.name][defaultParamName] = defaultParam;
                        }
                    }
                }
                if(addedParams.length > 0){
                    console.log(`Added params: ${addedParams}`)
                }
            }
        }
        return params;
    }
}

class Utils {
}


class MetadataHelper {

    constructor(logger=null, scihubUrl=null){
        this.SCIHUB_URL = scihubUrl == null ? "https://sci-hub.ru" : scihubUrl;
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
                pdfUrl = `${this.SCIHUB_URL}${pdfUrl}`;
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
            const scihubUrl = `${this.SCIHUB_URL}/${url}`;
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

module.exports = { PropsHelper, NotionHelper, ParamsSchema, Utils, MetadataHelper, fmt, LINK_SPLIT_REGEX };

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



