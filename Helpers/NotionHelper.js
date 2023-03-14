const sleep = require("timers/promises").setTimeout;

const { Client } = require("@notionhq/client")

class NotionHelper{
    static ParentType = {
        DATABASE:  'database_id',
        PAGE:  'page_id'
    }
    constructor(NOTION_KEY){
        this.notion = new Client({ auth: NOTION_KEY })
    }

    async getSingleDbEntry(masterDbId, idFieldName, pageId){
        return this.notion.databases.query({
            database_id: masterDbId,
            filter: {
                property: idFieldName,
                rich_text: {
                    contains: pageId
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

    updateBlock(bId, propsToUpdate){
        propsToUpdate['block_id'] = bId;
        return this.notion.blocks.children.update(propsToUpdate);
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

    createPageInPage(pId, props){
        const pType = NotionHelper.ParentType.PAGE;
        var parentData = { type: pType }
        parentData[pType] = dbId;
        return this.notion.pages.create({
                parent: parentData,
                properties: props
            })

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