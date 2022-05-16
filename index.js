/* ================================================================================

	database-update-send-email.
  
  Glitch example: https://glitch.com/edit/#!/notion-database-email-update
  Find the official Notion API client @ https://github.com/makenotion/notion-sdk-js/

================================================================================ */

const { Client } = require("@notionhq/client")
const dotenv = require("dotenv")
const config = require('./config.no-commit.json')
const axios =require('axios');
const Cite = require('citation-js')
const urlMetadata = require('url-metadata')

dotenv.config()
const notion = new Client({ auth: config.NOTION_KEY })

const databaseId = config.NOTION_DATABASE_ID

// /**
//  * Initialize local data store.
//  * Then poll for changes every 5 seconds (5000 milliseconds).
//  */
setInterval(getEntriesFromNotionDatabase, 50000)

/**
 * Gets tasks from the database.
 *
 * @returns {Promise<Array<{ pageId: string, status: string, title: string }>>}
 */
 async function getEntriesFromNotionDatabase() {
  const pages = []
  let cursor = undefined

  while (true) {
    const { results, next_cursor } = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
    })
    pages.push(...results)
    if (!next_cursor) {
      break
    }
    cursor = next_cursor
  }
  console.log(`${pages.length} pages successfully fetched.`)
  return pages
  .map(page => {
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
  })
}

async function getYoutubeMetadata(url){  
    const requestUrl = `https://youtube.com/oembed?url=${url}&format=json`;
    try{
      let data = await axios.get(requestUrl);
      data = data.data;
      return{
        title: data.title,
        author: [data.author_name],
        type: "Video"
      }
    }
    catch(error){
      console.log("Error YouTube metadata");
      console.error(error);
    };
}

async function getDOIMetadata(url){
  try{
    const citationJSON = await Cite.input(url)[0];
    return{
      title: citationJSON.title,
      author: citationJSON.author.map((x) => x.given + " " +x.family),
      type: "Paper"
    }
  }
  catch(error){
    console.log("Error DOI metadata " +url);
    console.error(error);
  }
}


async function getURLMetadata(url){
  try
  {
    const data = await urlMetadata(url);
    return{
      title:  data['og:title'] !== "" ? data['og:title'] : data.title,
      author: [data['og:site_name'] !== "" ? data['og:site_name'] : data.author !== "" ? data.author : data.source],
      type: "Post"
    }
  }
  catch(error){
    console.log("Error getting URL metadata");
    console.error(error);
  };
}

async function getMetadata(url) {
  let data = {};
  let type = "";
  if(url.toLowerCase().includes("youtub")){
    data = await getYoutubeMetadata(url);
    type="Youtube";
  }
  else if(url.toLowerCase().includes("doi")){
    data = await getDOIMetadata(url)
    type="DOI";
  }
  else{
    data = await getURLMetadata(url)
    type="URL";
  }
  console.log(`Got ${type} metadata from: ${url}`);
  console.log(data);
  return data;
}

async function updateEntry(entry) {
  // console.log(entry)
  getMetadata(entry.link.url).then((metadata) =>{
    const authors = metadata.author.map((x) => {return {'name': x}});
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
        }
      } 
    };
    console.log(updatedPage)
    notion.pages.update(updatedPage).then((response) => {
      updatedPage = {
        page_id: entry.page.id,
        properties: {
          'Script Processed':{
            checkbox: true
          }
        } 
      };
      response = notion.pages.update(updatedPage).then((response) => {
        console.log("Page updated!")
        console.log(response);        
      }).catch((error) => {
        console.log("Error updating page AGAIN!")
        console.log(error)
      });;
    }).catch((error) => {
      console.log("Error updating page!")
      console.log(error)
    });
  }).catch((error) => {
    console.log("Error getting link metadata!")
    console.log(error)
  });
}

// // addItem("Yurts in Big Sur, California")
async function getUnprocessedEntries(){
  return getEntriesFromNotionDatabase().then((pages) => {
    const unprocessed = pages.filter((p) => (!p.status && p.link && p.link.url && p.link.url !== ""))
    console.log(unprocessed.length > 0 ? `Found ${unprocessed.length} page(s) to process!` : `No new entries to process!`);
    return unprocessed;
  }).catch((error) => console.log("ERROR filtering pages!"))
}

async function updateUnprocessedEntries(){
  getUnprocessedEntries()
  .then((x) => x.map((entry) => updateEntry(entry)))
  .catch((error) => console.log("ERROR getting pages!"))
}


updateUnprocessedEntries()
setInterval(updateUnprocessedEntries, 5000)


