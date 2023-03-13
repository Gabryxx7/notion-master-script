#!/usr/bin/env node
const { PropsHelper } = require("../Helpers/PropsHelper.js")
// const { PropsHelper } = require("../Helpers/PropsHelper.js")
const { ParamsSchema } = require("../Helpers/ParamsHelpers.js")

// const databaseId = config.NOTION_DATABASE_ID

class PageObserver {
    static paramsSchema = new ParamsSchema()
        .addParam("databaseId", true)
        .addParam("scihubUrl", false, null)
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
    }

    async update() {
    }
}


module.exports = { PageObserver }