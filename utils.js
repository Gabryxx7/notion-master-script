
const ScriptStatus = {
    NONE: { "name": "None", "id": -1 },
    SCRIPT_NOT_FOUND: { "name": "Script Not Found", "id": 0 },
    NOT_STARTED: { "name": "Not Started", "id": 1 },
    RUNNING: { "name": "Running", "id": 2 },
    ERROR: { "name": "Error", "id": 3 }
  }
  
  const ScriptEnabledStatus = {
    DISABLED: { "name": "Disabled", "id": 0, "value": false },
    ENABLED: { "name": "Enabled", "id": 1, "value": true },
    TEST: { "name": "TEST", "id": -1, "value": false },
  }

class PropsHelper{
    constructor(){
        this.props = {}
    }
    addStatus(propName, statusName){
        this.props[propName] = { status: { name: statusName}};
        return this;
    }
    addRichText(propName, textContent){
        this.props[propName] = { rich_text: [{text: { content: textContent}}]};
        return this;
    }
    addTitle(propName, textContent) {
        this.props[propName] = { title: [{ text: { content: textContent }}] }
        return this;
    }
    addMultiSelect(propName, namesList){
        this.props[propName] = { multi_select: namesList}
        return this;
    }
    addSelect(propName, selectedName) {
        this.props[propName] = { select: { name: selectedName}}
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

    updatePage(pId, props, respHandler=null, errorHandler=null){
        this.notion.pages.update({
            page_id: pId,
            properties: props
        }).then((response) => {
            // console.log("Response:", response)
            if(respHandler != null) respHandler(response)
        }).catch((error) => {
            console.log(`Error updating page with ID ${pId}`, error) 
            if(errorHandler != null) errorHandler(error)
        });
    }

    createPage(pType, pId, props, respHandler=null, errorHandler=null){
        var parentData = {type: pType.field_name}
        parentData[pType.field_name] = pId;
        this.notion.pages.create({ // Add the new option through a new empty entry
            parent: parentData,
            properties: props
        }).then((response) => {
            // console.log("Response:", response)
            if(respHandler != null) respHandler(response)
        }).catch((error) => {
            // console.log(`Error creating page with parent ID ${pId}`, error) 
            if(errorHandler != null) errorHandler(error)
        });
    }

    deletePage(pId, respHandler=null, errorHandler=null){
        this.notion.pages.update({
            page_id: pId,
            archived: true
        }).then((response) => {
            // console.log("Response:", response)
            if(respHandler != null) respHandler(response)
        }).catch((error) => {
            console.log(`Error deleting page with ID ${pId}`, error) 
            if(errorHandler != null) errorHandler(error)
        });
    }

    searchDBs(respHandler=null, errorHandler=null){
        return new Promise((resolve, reject) => {
            this.notion.search({
                filter: { value: 'database', property: 'object'}
            }).then((response) => {
                // console.log("Response:", response)
                if(respHandler != null){
                    respHandler(response.results)
                }
                resolve();
            }).catch((error) => {
                console.log("Error listing databases!", error) 
                if(errorHandler != null){
                    errorHandler(error)
                }
                reject()
            });
        });
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
        for (const [paramName, param] of Object.entries(this.paramsData)) {
            if(param.needed){
                if(!(params.hasOwnProperty(param.name))){
                    throw new Error(`${param.name} is required`);
                }
            }
        }
        return true;
    }
}

class Utils {
}


class MetadataHelper {

    async getLinkMetadata(entry) {
        // console.log(entry);
        if (!entry.link.url || entry.link.url === "") {
            entry.link.url = entry.title;
        }
        let url = entry.link.url;
        let data = {};
        let type = "";
        if (url.toLowerCase().includes("youtu")) {
            data = await getYoutubeMetadata(url);
            type = "Youtube";
        }
        else if (url.toLowerCase().includes("doi")) {
            data = await getDOIMetadata(url)
            type = "DOI";
        }
        else {
            data = await getURLMetadata(url)
            type = "URL";
        }
        console.log(`Got ${type} metadata from: ${url}`);
        console.log(data);
        data.url = url;
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
            console.log("Error YouTube metadata");
            console.error(error);
        };
    }

    async getDOIMetadata(url) {
        try {
            const citationJSON = await Cite.input(url)[0];
            return {
                title: citationJSON.title,
                author: citationJSON.author.map((x) => x.given + " " + x.family),
                type: "Paper"
            }
        }
        catch (error) {
            console.log("Error DOI metadata " + url);
            console.error(error);
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
            console.log("Error getting URL metadata");
            console.error(error);
        };
    }

}

module.exports = { PropsHelper, NotionHelper, ScriptStatus, ScriptEnabledStatus, ParamsSchema, Utils, MetadataHelper };

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



