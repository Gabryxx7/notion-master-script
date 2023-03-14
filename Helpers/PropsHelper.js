class PropsHelper{
    constructor(props=null, pageProps=null){
        this.props = !props ? {} : props;
        this.pageProps = pageProps;
    }
    update(newProps){
        for(const [propName, prop] of Object.entries(newProps)) {
            this.props[propName] = newProps[propName];
        }
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
    getStatus(propName){
        return this.props[propName]?.status?.name;
    }
    addCheckbox(propName, ticked){
        if(!this.isPropInDB(propName)) return this;
        this.props[propName] = { checkbox: ticked };
        return this;
    }
    getCheckbox(propName){
        return this.props[propName]?.checkbox;
    }
    addRichText(propName, textContent){
        if(!this.isPropInDB(propName)) return this;
        if(!textContent) return this;
        this.props[propName] = { rich_text: [{text: { content: textContent}}]};
        return this;
    }
    addText(propName, textContent){
        if(!this.isPropInDB(propName)) return this;
        if(!textContent) return this;
        this.props[propName] = { text: [{text: { content: textContent}}]};
        return this;
    }
    getText(propName){
        return this.props[propName]?.rich_text[0]?.plain_text;
    }
    addTitle(propName, textContent) {
        if(!this.isPropInDB(propName)) return this;
        if(!textContent) return this;
        this.props[propName] = { title: [{ text: { content: textContent }}] }
        return this;
    }
    getTitle(propName){
        return this.props[propName]?.title[0]?.plain_text;
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
    getSelect(propName){
        return this.props[propName]?.select?.name;
    }
    addLink(propName, url, as_text=false, title=null) {
        if(!title) title = url;
        if(as_text){
            if(!title) title = url;
            this.props[propName] = { rich_text: [{text: { content: title, link: {url: url}}}]};
        }
        else{
            this.props[propName] = {url: url}  
        }  
        return this;
    }
    getLink(propName, from_text=false){
        try{
            if(from_text) return this.props[propName]?.rich_text[0]?.text?.link?.url;
            return this.props[propName]?.url;
        }
        catch(error){
            return null;
        }
    }
    build(){
        return this.props;
    }
}

module.exports = { PropsHelper };