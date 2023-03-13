const sleep = require("timers/promises").setTimeout;

const { Client } = require("@notionhq/client")

class NotionHelper{
    static ParentType = {
        DATABASE: {field_name: 'database_id'}
    }
    constructor(NOTION_KEY){
        this.notion = new Client({ auth: NOTION_KEY })
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

    retrievePageBlocks(bId){
       return this.notion.blocks.children.list({
            block_id: bId,
            page_size: 50,
        });
    }

    appendBlocks(bId, blocksList){
        return this.notion.blocks.children.append({
            block_id: bId,
            children: blocksList
        })
    }

    retrieveBlock(bId){
        return this.notion.blocks.retrieve({
            block_id: bId
        });
    }

    updatePage(pId, props){
        return this.notion.pages.update({
            page_id: pId,
            properties: props
        });
    }

    createPageInDb(dbId, props){
        const pType = NotionHelper.ParentType.DATABASE;
        var parentData = { type: pType.field_name }
        parentData[pType.field_name] = dbId;
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

module.exports = { NotionHelper };